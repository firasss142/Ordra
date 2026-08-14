// Per-actor contribution to one product over one window — the AGENTS section
// of the product sheet.
//
// ── WHY THIS IS TYPESCRIPT AND NOT A RPC ──────────────────────────────────
// Same reason metrics.ts gives, plus one of its own. There is no reusable RPC:
// `get_agent_metrics` is market-global (no p_product_id), returns four scalars
// and folds `dispatched` — a status the warehouse posts, not the agent — into
// its `actioned`; `get_product_agent_signals` is product-global with no actor
// dimension and is granted to service_role only. Writing the attribution in
// PL/pgSQL would put the one formula a manager's bonus depends on somewhere
// Vitest cannot execute, which collides head-on with the TDD rule.
//
// The attribution below IS expressible in SQL — it is exactly
//     DISTINCT ON (order_id) … WHERE status_to='confirmed'
//     ORDER BY order_id, created_at DESC
// and that query was run against production to validate these numbers. It stays
// in TypeScript so the rule keeps its unit tests. Promote it when a single
// product's order_history passes ~50k rows; today the busiest is ~4k, i.e. four
// pages of fetchAllRows.

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Role } from "@/types";
import type { ProductAgentRow } from "@/types/product-agents";

/**
 * Call attempts. Counted as ROWS for `calls` (three attempts on one order are
 * three calls) and as DISTINCT ORDERS for `orders_called`.
 */
export const CALL_STATUSES = ["attempt_1", "attempt_2", "attempt_3"] as const;

/**
 * The statuses an AGENT can post. This set alone defines `orders_treated`.
 *
 * `pending` is excluded even though bulk imports write it with a non-null
 * actor_id — nearly 6000 such rows exist, and counting them reported 605
 * "treated" orders for an admin account that never picked up a phone.
 * `uploaded` is excluded because the dispatch cron posts it: it measures the
 * carrier push, not the conversation. Widening this set silently inflates one
 * column of a leaderboard, so it lives here, exported and under test.
 */
export const AGENT_ACTION_STATUSES = [
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "rejected",
] as const;

/**
 * Attribution key: everything downstream of the confirmation belongs to the
 * LAST actor who confirmed.
 *
 * `confirmed` only, never `confirmed | uploaded`. The upload is posted by the
 * cron or by whoever pushed the batch to the carrier, so including it would
 * reassign a night's confirmations to a system account. Validated against
 * production: with `confirmed` alone the five Libyan agents reproduce their
 * measured confirmed / delivered / returned / in-flight / revenue to the unit.
 */
export const ATTRIBUTION_STATUS = "confirmed" as const;

/**
 * Current statuses that mean "still with the carrier, outcome unknown".
 *
 * Just `uploaded` — that is the set the production validation ran on. Widening
 * it (scanned, dispatched, in_transit…) moves orders out of `other` and into
 * `in_flight`; the closing identity survives either way, but the two columns
 * stop matching the figures the section was specified against.
 */
export const IN_FLIGHT_STATUSES = ["uploaded"] as const;

/**
 * Structurally typed rather than SupabaseClient — same compromise metrics.ts
 * documents: the generated client type infers the embedded `orders` relation as
 * an array where this query reads it as a single record. Resolving on `.range`
 * is what makes a builder compatible with fetchAllRows.
 *
 * `.order` is present here and absent from MetricsQueryBuilder on purpose: this
 * module PAGES and then SCANS, and range-paging without an ORDER BY lets
 * Postgres repeat or skip rows across page boundaries. For a counter that is a
 * wrong number; for the attribution scan it is the wrong owner.
 */
export interface ProductAgentsQueryBuilder {
  select: (columns: string) => ProductAgentsQueryBuilder;
  in: (column: string, values: readonly unknown[]) => ProductAgentsQueryBuilder;
  eq: (column: string, value: unknown) => ProductAgentsQueryBuilder;
  gte: (column: string, value: unknown) => ProductAgentsQueryBuilder;
  lte: (column: string, value: unknown) => ProductAgentsQueryBuilder;
  order: (column: string, opts?: { ascending?: boolean }) => ProductAgentsQueryBuilder;
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ProductAgentsClient {
  from: (table: string) => ProductAgentsQueryBuilder;
}

interface LoadArgs {
  supabase: ProductAgentsClient;
  productId: string;
  fromDate: string;
  toDate: string;
}

type HistoryRow = {
  order_id: string | null;
  actor_id: string | null;
  status_to: string;
  created_at: string;
};
type OrderRow = { id: string; status: string | null; total_price: number | string | null };
type UserRow = { id: string; full_name: string | null; role: Role | null };

/** Map key for the unattributed bucket. Never a valid uuid, so it cannot collide. */
const UNATTRIBUTED = "";

interface Bucket {
  calls: number;
  called: Set<string>;
  treated: Set<string>;
  confirmed: number;
  delivered: number;
  returned: number;
  in_flight: number;
  other: number;
  revenue: number;
}

function emptyBucket(): Bucket {
  return {
    calls: 0,
    called: new Set(),
    treated: new Set(),
    confirmed: 0,
    delivered: 0,
    returned: 0,
    in_flight: 0,
    other: 0,
    revenue: 0,
  };
}

const isCall = (status: string) => (CALL_STATUSES as readonly string[]).includes(status);
const isInFlight = (status: string | null | undefined) =>
  status != null && (IN_FLIGHT_STATUSES as readonly string[]).includes(status);

/**
 * One row per actor who touched this product's orders inside the window.
 *
 * Returns `[]` — never a zero-filled roster — when nobody acted. Unlike
 * loadProductPeriodMetrics, which must emit an entry per product because
 * absence there is indistinguishable from "not permitted", the caller here has
 * no list of expected actors to reconcile against.
 */
export async function loadProductAgentPerformance({
  supabase,
  productId,
  fromDate,
  toDate,
}: LoadArgs): Promise<ProductAgentRow[]> {
  const toDateEnd = `${toDate}T23:59:59.999Z`;

  const [historyRows, orderRows] = await Promise.all([
    // ONE history read, not two. The attribution rows (`confirmed`) are a
    // subset of the action rows, so splitting them would transport the
    // confirmations twice for no gain.
    //
    // Windowed on order_history.created_at, so "last confirmer" means the last
    // confirmer WITHIN the window: a re-confirmation next month must not
    // retroactively move this month's numbers between two agents. Consistent
    // with metrics.ts, which windows every count the same way.
    fetchAllRows<HistoryRow>(
      supabase
        .from("order_history")
        .select("order_id, actor_id, status_to, created_at, orders!inner(product_id)")
        .eq("orders.product_id", productId)
        .in("status_to", AGENT_ACTION_STATUSES)
        .gte("created_at", fromDate)
        .lte("created_at", toDateEnd)
        // (created_at, id) is a total order: created_at alone is not unique, and
        // ties would otherwise resolve differently on every request.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ),
    // NOT windowed, and that is the whole point: an order confirmed on the last
    // day of the window is delivered a week later, and its bucket must follow
    // its CURRENT status. Reading the whole product's orders costs one extra
    // page at today's volumes and removes an entire class of boundary bug.
    fetchAllRows<OrderRow>(
      supabase
        .from("orders")
        .select("id, status, total_price")
        .eq("product_id", productId)
        .order("id", { ascending: true }),
    ),
  ]);

  const buckets = new Map<string, Bucket>();
  const bucketFor = (key: string): Bucket => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const fresh = emptyBucket();
    buckets.set(key, fresh);
    return fresh;
  };

  /** order_id → actor key of its last confirmation in the window. */
  const owner = new Map<string, string>();

  for (const row of historyRows) {
    if (!row.order_id) continue;
    const key = row.actor_id ?? UNATTRIBUTED;
    const bucket = bucketFor(key);

    bucket.treated.add(row.order_id);
    if (isCall(row.status_to)) {
      bucket.calls += 1;
      bucket.called.add(row.order_id);
    }
    // Rows arrive in ascending (created_at, id): the last write wins, which is
    // the DESC-ordered DISTINCT ON validated in SQL.
    if (row.status_to === ATTRIBUTION_STATUS) owner.set(row.order_id, key);
  }

  const orderById = new Map<string, OrderRow>();
  for (const o of orderRows) orderById.set(String(o.id), o);

  for (const [orderId, key] of owner) {
    const bucket = bucketFor(key);
    bucket.confirmed += 1;

    const status = orderById.get(orderId)?.status;
    if (status === "delivered") {
      bucket.delivered += 1;
      bucket.revenue += Number(orderById.get(orderId)?.total_price ?? 0);
    } else if (status === "returned") {
      bucket.returned += 1;
    } else if (isInFlight(status)) {
      bucket.in_flight += 1;
    } else {
      // Includes `status === undefined`: an order confirmed in the window whose
      // row is no longer readable. It has to land somewhere or the closing
      // identity breaks by one, silently, for that actor only.
      bucket.other += 1;
    }
  }

  const actorIds = [...buckets.keys()].filter((k) => k !== UNATTRIBUTED);

  // Skipped entirely when nobody acted — an `.in("id", [])` is a round trip that
  // can only return nothing.
  const userRows = actorIds.length
    ? await fetchAllRows<UserRow>(
        supabase
          .from("users")
          .select("id, full_name, role")
          .in("id", actorIds)
          .order("id", { ascending: true }),
      )
    : [];
  const userById = new Map<string, UserRow>();
  for (const u of userRows) userById.set(String(u.id), u);

  const rows: ProductAgentRow[] = [...buckets.entries()].map(([key, b]) => {
    const user = key === UNATTRIBUTED ? undefined : userById.get(key);
    return {
      actor_id: key === UNATTRIBUTED ? null : key,
      // Null, not a placeholder string: the fallback label is a UI decision and
      // has to be translated. RLS invisibility and "no actor at all" are two
      // different states and the UI distinguishes them via actor_id.
      full_name: user?.full_name ?? null,
      role: user?.role ?? null,
      calls: b.calls,
      orders_called: b.called.size,
      orders_treated: b.treated.size,
      confirmed: b.confirmed,
      delivered: b.delivered,
      returned: b.returned,
      in_flight: b.in_flight,
      other: b.other,
      // Millimes: money is NUMERIC(10,3) in Postgres, and summing float prices
      // without this drifts into 5141.999999999999.
      revenue: Math.round(b.revenue * 1000) / 1000,
    };
  });

  // A stable DEFAULT order, not a ranking. The leaderboard sorts by whichever
  // column the user picked and splits managers out of the classement; that is a
  // UI concern. Deterministic here only so two identical requests paint
  // identically and a Map's insertion order never leaks into the UI.
  rows.sort(
    (a, b) =>
      b.confirmed - a.confirmed ||
      b.delivered - a.delivered ||
      b.orders_treated - a.orders_treated ||
      (a.actor_id ?? "").localeCompare(b.actor_id ?? ""),
  );

  return rows;
}
