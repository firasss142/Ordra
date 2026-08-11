import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { minutesBetween } from "@/lib/format";
import {
  ALERT_TYPES,
  familyOf,
  isExpired,
  severityFor,
  SEVERITY_RANK,
  type AlertSeverity,
  type AlertType,
} from "@/lib/alerts/catalogue";
import type { Alert, AlertsSummary } from "@/lib/alerts/types";

export const dynamic = "force-dynamic";

export type { Alert, AlertsSummary, AlertType, AlertSeverity };

// Trigger thresholds. How loud an alert gets afterwards, and when it stops
// being one at all, lives in lib/alerts/catalogue.ts.
const UNASSIGNED_OVERFLOW_MINUTES = 120;
const PENDING_IDLE_HOURS = 4;
const ATTEMPTS_STALLED_HOURS = 24;
const MIN_ATTEMPTS_PER_DAY = 2;
const UPLOAD_STALLED_HOURS = 24;
const DISPATCH_FAILURE_HOURS = 72;
const CARRIER_STALE_DAYS = 7;
/** How far back the audit rules read the history log — their own expiry. */
const OVERSIGHT_LOOKBACK_DAYS = 7;
const ITEMS_PER_QUERY = 50;

/** Statuses that still owe the customer a phone call. */
const OPEN_CONFIRMATION_STATUSES = ["pending", "assigned", "attempt_1"];

interface OrderRow {
  id: string;
  market_id: string;
  customer_name: string | null;
  product_name: string | null;
  callback_scheduled_at?: string | null;
  scheduled_dispatch_at?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: string;
  attempts_count?: number | null;
}

interface ProductRow {
  id: string;
  market_id: string;
  name: string;
  current_stock: number;
}

interface JoinedOrder {
  customer_name: string | null;
  product_name: string | null;
  market_id: string;
}

interface HistoryRow {
  id: string;
  order_id: string;
  actor_type: string | null;
  note: string | null;
  created_at: string;
  /** PostgREST types a to-one embed as an array; at runtime it is an object. */
  orders: JoinedOrder | JoinedOrder[] | null;
}

function joinedOrder(row: HistoryRow): JoinedOrder | null {
  const o = row.orders;
  if (!o) return null;
  return Array.isArray(o) ? o[0] ?? null : o;
}

interface AckRow {
  alert_key: string;
  acknowledged_at: string | null;
  snoozed_until: string | null;
}

function alertKey(type: AlertType, entityId: string): string {
  return `${type}:${entityId}`;
}

/**
 * Did an agent change what the customer pays?
 *
 * `PATCH /orders/[id]` writes the edited fields as a JSON note. `unit_price` and
 * `delivery_fee` are the two that move the money; both only appear in the note
 * when the client actually sent them, so a recomputed total does not trip this.
 */
function isPriceEdit(note: string | null): boolean {
  if (!note || !note.trim().startsWith("{")) return false;
  try {
    const parsed = JSON.parse(note) as Record<string, unknown>;
    return "unit_price" in parsed || "delivery_fee" in parsed;
  } catch {
    return false;
  }
}

/** Reopen notes are written by the `reopen_order` RPC, all of them prefixed. */
function isReopen(note: string | null): boolean {
  return !!note && /^Reouvert/i.test(note.normalize("NFC").replace(/[éÉ]/g, "e"));
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actor.market_id ?? "";

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();
  const daysAgo = (d: number) => hoursAgo(d * 24);

  const scoped = <T>(q: T): T => (marketId ? (q as { eq: (c: string, v: string) => T }).eq("market_id", marketId) : q);

  // ── Order-shaped rules. The order of these queries is mirrored by the test
  //    harness, which can only tell them apart by call sequence. ────────────
  const qOverdueCallback = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, callback_scheduled_at")
      .eq("status", "callback_scheduled")
      .lt("callback_scheduled_at", nowIso)
      .order("callback_scheduled_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qUnassigned = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, created_at")
      .eq("status", "pending")
      .is("assigned_to", null)
      .lt("created_at", new Date(now - UNASSIGNED_OVERFLOW_MINUTES * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qDispatchFailure = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, updated_at")
      .in("status", ["confirmed", "scanned"])
      .lt("updated_at", hoursAgo(DISPATCH_FAILURE_HOURS))
      .order("updated_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qCarrierStale = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, updated_at")
      .eq("status", "in_transit")
      .lt("updated_at", daysAgo(CARRIER_STALE_DAYS))
      .order("updated_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  // Assigned, still `pending`, and nobody has touched it — distinct from
  // unassigned_overflow, where there is no agent to blame.
  const qPendingIdle = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, updated_at")
      .eq("status", "pending")
      .not("assigned_to", "is", null)
      .lt("updated_at", hoursAgo(PENDING_IDLE_HOURS))
      .order("updated_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qAttemptsStalled = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, created_at, attempts_count")
      .in("status", OPEN_CONFIRMATION_STATUSES)
      .not("assigned_to", "is", null)
      .lt("created_at", hoursAgo(ATTEMPTS_STALLED_HOURS))
      .order("created_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qScheduleMissed = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, scheduled_dispatch_at")
      .eq("status", "dispatch_scheduled")
      .lt("scheduled_dispatch_at", nowIso)
      .order("scheduled_dispatch_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qUploadStalled = scoped(
    supabase
      .from("orders")
      .select("id, market_id, customer_name, product_name, status, updated_at")
      .eq("status", "uploaded")
      .lt("updated_at", hoursAgo(UPLOAD_STALLED_HOURS))
      .order("updated_at", { ascending: true })
      .limit(ITEMS_PER_QUERY),
  );

  const qStockDepleted = scoped(
    supabase
      .from("products")
      .select("id, market_id, name, current_stock")
      .eq("is_active", true)
      .lte("current_stock", 0)
      .limit(100),
  );

  // Both oversight rules read the same slice of the log, so they share a query
  // and are told apart by their note. Filtering the join needs `!inner`.
  let qOversight = supabase
    .from("order_history")
    .select("id, order_id, actor_type, note, created_at, orders!inner(customer_name, product_name, market_id)")
    .eq("actor_type", "agent")
    .gt("created_at", daysAgo(OVERSIGHT_LOOKBACK_DAYS))
    .order("created_at", { ascending: false })
    .limit(ITEMS_PER_QUERY);
  if (marketId) qOversight = qOversight.eq("orders.market_id", marketId);

  let qAcks = supabase
    .from("alert_acknowledgements")
    .select("alert_key, acknowledged_at, snoozed_until");
  if (marketId) qAcks = qAcks.eq("market_id", marketId);

  const [
    overdueRes,
    unassignedRes,
    dispatchStuckRes,
    carrierStaleRes,
    pendingIdleRes,
    attemptsStalledRes,
    scheduleMissedRes,
    uploadStalledRes,
    stockRes,
    oversightRes,
    acksRes,
  ] = await Promise.all([
    qOverdueCallback,
    qUnassigned,
    qDispatchFailure,
    qCarrierStale,
    qPendingIdle,
    qAttemptsStalled,
    qScheduleMissed,
    qUploadStalled,
    qStockDepleted,
    qOversight,
    qAcks,
  ]);

  const failed = Object.entries({
    overdue: overdueRes.error,
    unassigned: unassignedRes.error,
    dispatchStuck: dispatchStuckRes.error,
    carrierStale: carrierStaleRes.error,
    pendingIdle: pendingIdleRes.error,
    attemptsStalled: attemptsStalledRes.error,
    scheduleMissed: scheduleMissedRes.error,
    uploadStalled: uploadStalledRes.error,
    stock: stockRes.error,
    oversight: oversightRes.error,
    acks: acksRes.error,
  }).filter(([, err]) => err);

  if (failed.length > 0) {
    console.error("[alerts/summary] query failures:", failed.map(([k, e]) => ({ query: k, error: e })));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ackByKey = new Map<string, AckRow>();
  for (const a of (acksRes.data ?? []) as AckRow[]) ackByKey.set(a.alert_key, a);

  const candidates: Alert[] = [];

  function push(input: {
    type: AlertType;
    entityId: string;
    entityKind: Alert["entity_kind"];
    href: string;
    primary: string;
    secondary?: string | null;
    /** The timestamp this rule measures from — drives severity AND the reading. */
    anchor: string | null;
    meta?: Record<string, number | string> | null;
    marketId: string | null;
  }) {
    const id = alertKey(input.type, input.entityId);

    const ack = ackByKey.get(id);
    if (ack?.acknowledged_at) return;
    if (ack?.snoozed_until && new Date(ack.snoozed_until).getTime() > now) return;

    const ageMinutes = input.anchor ? Math.max(0, minutesBetween(input.anchor, now)) : 0;
    if (isExpired(input.type, ageMinutes)) return;

    candidates.push({
      id,
      type: input.type,
      severity: severityFor(input.type, ageMinutes),
      entity_id: input.entityId,
      entity_kind: input.entityKind,
      href: input.href,
      primary: input.primary,
      secondary: input.secondary ?? null,
      age_minutes: ageMinutes,
      meta: input.meta ?? null,
      created_at: input.anchor ?? nowIso,
      market_id: input.marketId,
    });
  }

  /** Every order-shaped rule differs only in its type and its anchor column. */
  function pushOrders(
    rows: unknown,
    type: AlertType,
    anchorOf: (o: OrderRow) => string | null | undefined,
    metaOf?: (o: OrderRow) => Record<string, number | string> | null,
  ) {
    for (const o of (rows ?? []) as OrderRow[]) {
      push({
        type,
        entityId: o.id,
        entityKind: "order",
        href: `/orders/${o.id}`,
        primary: o.customer_name ?? "",
        secondary: o.product_name ?? null,
        anchor: anchorOf(o) ?? null,
        meta: metaOf?.(o) ?? null,
        marketId: o.market_id,
      });
    }
  }

  pushOrders(overdueRes.data, "overdue_callback", (o) => o.callback_scheduled_at);
  pushOrders(unassignedRes.data, "unassigned_overflow", (o) => o.created_at);
  pushOrders(dispatchStuckRes.data, "dispatch_failure", (o) => o.updated_at);
  if (role === "super_admin") {
    pushOrders(carrierStaleRes.data, "carrier_webhook_stale", (o) => o.updated_at);
  }
  pushOrders(pendingIdleRes.data, "pending_idle", (o) => o.updated_at);
  pushOrders(scheduleMissedRes.data, "dispatch_schedule_missed", (o) => o.scheduled_dispatch_at);
  pushOrders(uploadStalledRes.data, "upload_stalled", (o) => o.updated_at);

  // The attempt count is the point of this rule, and it cannot be expressed as
  // a column filter while nulls mean "never called".
  const understaffed = ((attemptsStalledRes.data ?? []) as OrderRow[]).filter(
    (o) => (o.attempts_count ?? 0) < MIN_ATTEMPTS_PER_DAY,
  );
  pushOrders(understaffed, "attempts_stalled", (o) => o.created_at, (o) => ({
    attempts: o.attempts_count ?? 0,
  }));

  for (const p of (stockRes.data ?? []) as ProductRow[]) {
    if (p.current_stock > 0) continue;
    push({
      type: "stock_depleted",
      entityId: p.id,
      entityKind: "product",
      href: `/products/${p.id}`,
      primary: p.name,
      anchor: null,
      meta: { current_stock: p.current_stock },
      marketId: p.market_id,
    });
  }

  for (const h of (oversightRes.data ?? []) as unknown as HistoryRow[]) {
    // Both oversight rules watch agent behaviour specifically: a manager
    // correcting a price is not the thing being reviewed, and system rows
    // would fire on every webhook.
    if (h.actor_type !== "agent") continue;

    const type: AlertType | null = isPriceEdit(h.note)
      ? "price_changed"
      : isReopen(h.note)
        ? "order_reopened"
        : null;
    if (!type) continue;

    const joined = joinedOrder(h);
    push({
      type,
      entityId: h.order_id,
      entityKind: "order",
      href: `/orders/${h.order_id}`,
      primary: joined?.customer_name ?? "",
      secondary: joined?.product_name ?? null,
      anchor: h.created_at,
      marketId: joined?.market_id ?? null,
    });
  }

  // ── One row per problem ─────────────────────────────────────────────────
  // Several `progress` rules can catch the same order at once; the loudest is
  // the only useful one. Families keep an audit event from being swallowed by
  // an unrelated stall on the same order.
  const loudest = new Map<string, Alert>();
  for (const a of candidates) {
    const key = `${familyOf(a.type)}:${a.entity_id}`;
    const held = loudest.get(key);
    if (
      !held ||
      SEVERITY_RANK[a.severity] < SEVERITY_RANK[held.severity] ||
      (a.severity === held.severity && a.age_minutes > held.age_minutes)
    ) {
      loudest.set(key, a);
    }
  }

  const alerts = [...loudest.values()].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    // Oldest first inside a band — it has been waiting longest.
    return b.age_minutes - a.age_minutes;
  });

  const by_severity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_type = {} as Record<AlertType, number>;
  for (const type of ALERT_TYPES) by_type[type] = 0;
  for (const a of alerts) {
    by_severity[a.severity] += 1;
    by_type[a.type] += 1;
  }

  const body: AlertsSummary = { total: alerts.length, by_severity, by_type, alerts };
  return NextResponse.json(body);
}
