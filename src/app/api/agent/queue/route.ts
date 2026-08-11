import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortAgentQueue } from "@/lib/orders/queue-sort";
import { resolveProductDisplayName, unwrapEmbed } from "@/lib/orders/display-name";
import { getActor } from "@/lib/auth/actor";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";
import { enrichRowsWithDuplicates } from "@/lib/duplicate-orders/detect";
import { enCoursBucket } from "@/lib/queue/schedule-bucket";

export const dynamic = "force-dynamic";

/**
 * Stamps `last_action_at` — when an agent last touched each order — onto the
 * rows in place.
 *
 * The source is `order_history`, not `orders.updated_at`. `trg_orders_updated_at`
 * (001_initial_schema.sql) fires on every write, and the Dexpress / Darb status
 * polls write to these rows, so `updated_at` would report an order as freshly
 * handled minutes after a cron touched it — a column that lies.
 *
 * Rows come back newest-first, so the first hit per order_id is the max. The
 * limit is a backstop far above any real queue (an agent holds tens of orders,
 * each with a handful of transitions); because the sort is descending, hitting
 * it could only ever drop rows older than ones already kept.
 */
const HISTORY_ROW_CAP = 10_000;

async function attachLastAgentAction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groups: Array<Array<Record<string, unknown> & { id: string }>>,
): Promise<void> {
  const ids = groups.flat().map((o) => o.id);
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from("order_history")
    .select("order_id, created_at")
    .in("order_id", ids)
    .eq("actor_type", "agent")
    .order("created_at", { ascending: false })
    .limit(HISTORY_ROW_CAP);

  // A history read failing must not take the queue down with it — the column
  // simply reads "never actioned" until the next poll.
  const latest = new Map<string, string>();
  if (!error) {
    for (const row of (data ?? []) as Array<{ order_id: string; created_at: string }>) {
      if (!latest.has(row.order_id)) latest.set(row.order_id, row.created_at);
    }
  }

  for (const order of groups.flat()) {
    order.last_action_at = latest.get(order.id) ?? null;
  }
}

const ACTIVE_QUEUE_STATUSES = [
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
];

const CLOSED_STATUSES = [
  "rejected",
  "uploaded",
  "dispatched",
];

const CLOSED_WINDOW_DAYS = 7;

export async function GET(_req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(_req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const closedSince = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [activeRes, closedRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*, product:products(image_url, name), carrier:carriers!orders_carrier_id_fkey(code,name)")
      .eq("assigned_to", actor.id)
      .in("status", ACTIVE_QUEUE_STATUSES),
    supabase
      .from("orders")
      .select("*, product:products(image_url, name), carrier:carriers!orders_carrier_id_fkey(code,name)")
      .eq("assigned_to", actor.id)
      .in("status", CLOSED_STATUSES)
      .gte("updated_at", closedSince.toISOString())
      .order("updated_at", { ascending: false }),
  ]);

  if (activeRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Flatten the joined product image + carrier onto each row, so the queue card
  // can show a product thumbnail and the carrier's brand logo. Mirrors
  // /api/orders/list.
  type CarrierJoin = { code: string | null; name: string | null };
  type ProductJoin = { image_url: string | null; name?: string | null };
  type RawRow = Record<string, unknown> & {
    id: string;
    status: string;
    callback_scheduled_at: string | null;
    scheduled_dispatch_at: string | null;
    scheduled_dispatch_auto: boolean | null;
    created_at: string;
    product?: ProductJoin | ProductJoin[] | null;
    carrier?: CarrierJoin | CarrierJoin[] | null;
  };
  type FlatRow = Record<string, unknown> & {
    id: string;
    status: string;
    callback_scheduled_at: string | null;
    scheduled_dispatch_at: string | null;
    scheduled_dispatch_auto: boolean | null;
    created_at: string;
    product_image_url: string | null;
    product_display_name: string;
    carrier_code: string | null;
    carrier_name: string | null;
  };
  // raw_payload is dropped here, not selected-around, because the two queries
  // above use select("*") for the ~30 other columns the queue does need.
  // It is the single largest key on the wire — 372 bytes/row averaged over the
  // 1,608 rows currently in agent queues fleet-wide, ~30% of the whole body —
  // and nothing in the agent interface reads it (grep: only the leads adapters,
  // the webhook handler and /api/orders/[id] touch it, and that route strips it
  // too). Mirrors the same strip in src/app/api/orders/[id]/route.ts.
  const flattenJoins = (rows: RawRow[]): FlatRow[] =>
    rows.map(({ product, carrier, raw_payload: _rawPayload, ...rest }) => {
      const c = unwrapEmbed(carrier);
      return {
        ...(rest as Omit<RawRow, "product" | "carrier">),
        product_image_url: unwrapEmbed(product)?.image_url ?? null,
        product_display_name: resolveProductDisplayName({
          product_name: rest.product_name as string | null,
          product,
        }),
        carrier_code: c?.code ?? null,
        carrier_name: c?.name ?? null,
      } as FlatRow;
    });

  const allOrders = flattenJoins((activeRes.data ?? []) as RawRow[]);
  const closedOrders = flattenJoins((closedRes.data ?? []) as RawRow[]);

  await attachLastAgentAction(supabase, [allOrders, closedOrders]);

  const activeOrders = allOrders.filter((o) => {
    // confirmed (without carrier) stays in the active queue so the agent
    // can finish the upload step. Once uploaded, the order leaves the
    // active queue and shows in the closed bucket.
    if (o.status === "callback_scheduled") {
      // A callback with no scheduled time is unscheduled pending work the
      // agent still owns — surface it. Only an explicitly future time hides
      // the order (until that time arrives).
      return !o.callback_scheduled_at || new Date(o.callback_scheduled_at) <= now;
    }
    if (o.status === "dispatch_scheduled") {
      // Auto-upload rows always surface so the agent can deliver them manually
      // ahead of the cron, regardless of the scheduled time. Manual rows
      // surface immediately unless an explicitly future time holds them back
      // until then.
      if (o.scheduled_dispatch_auto) return true;
      return !o.scheduled_dispatch_at || new Date(o.scheduled_dispatch_at) <= now;
    }
    return true;
  });

  const sorted = sortAgentQueue(activeOrders);

  const buckets = {
    nouveau: 0,
    tentative_1: 0,
    tentative_2: 0,
    tentative_3: 0,
    tentative_total: 0,
    rappel_prevu: 0,
    livraison_planifiee: 0,
    confirme: 0,
    rejete: 0,
    fermees: closedOrders.length,
  };

  const nowMs = now.getTime();

  for (const o of allOrders) {
    const s = o.status as string;
    if (s === "pending" || s === "assigned") buckets.nouveau++;
    else if (s === "attempt_1") {
      buckets.tentative_1++;
      buckets.tentative_total++;
    } else if (s === "attempt_2") {
      buckets.tentative_2++;
      buckets.tentative_total++;
    } else if (s === "attempt_3") {
      buckets.tentative_3++;
      buckets.tentative_total++;
    } else if (s === "callback_scheduled" || s === "dispatch_scheduled") {
      // Computed over `allOrders`, which is what the queue actually renders —
      // not over the time-filtered `activeOrders`. Every scheduled row lands in
      // exactly one bucket, so tentative_total + rappel_prevu +
      // livraison_planifiee is always the number of rows "Tous" opens. It used
      // to be smaller, because future-scheduled rows were counted nowhere.
      const bucket = enCoursBucket(
        {
          status: s,
          callback_scheduled_at: o.callback_scheduled_at as string | null,
          scheduled_dispatch_at: o.scheduled_dispatch_at as string | null,
          scheduled_dispatch_auto: o.scheduled_dispatch_auto as boolean | null,
        },
        nowMs,
      );
      if (bucket === "rappel") buckets.rappel_prevu++;
      else if (bucket === "livraison") buckets.livraison_planifiee++;
    } else if (s === "confirmed") buckets.confirme++;
  }

  for (const o of closedOrders) {
    if (o.status === "rejected") buckets.rejete++;
  }

  const sortedIds = new Set(sorted.map((o) => o.id));
  const allSorted = [...sorted, ...allOrders.filter((o) => !sortedIds.has(o.id))];

  // Enrich with repeat-buyer signals + duplicate-order detection across the
  // visible queue + closed list. The two signals are distinct: repeat-buyer is
  // the same customer over time; duplicate is the same order placed twice.
  const marketId = actor.market_id ?? null;

  // Two RPC calls, not four, and concurrent rather than chained.
  //
  // This used to be two branches (active, closed), each running
  // customerHistory().then(duplicates()) — so four round trips, sequential
  // within each branch. The two enrichments are independent: each builds its
  // payload only from original row fields (id, phone, phone_2, name, address,
  // city / product_id, product_name, quantity, created_at), and neither reads a
  // field the other produces. And the two branches hit the same market, so one
  // call over the union does the work of two.
  //
  // Both enrichers end in `rows.map(...)`, so output order matches input order
  // and the index split below is exact. allSorted and closedOrders are disjoint
  // (active statuses vs closed statuses).
  const unionRows = [...allSorted, ...closedOrders];
  const [withHistory, withDuplicates] = await Promise.all([
    enrichRowsWithCustomerHistory(supabase, marketId, "order", unionRows),
    enrichRowsWithDuplicates(supabase, marketId, unionRows),
  ]);
  const enrichedUnion = unionRows.map((_row, i) => ({
    ...withHistory[i],
    ...withDuplicates[i],
  }));
  const enrichedActive = enrichedUnion.slice(0, allSorted.length);
  const enrichedClosed = enrichedUnion.slice(allSorted.length);

  const enrichedSorted = enrichedActive.filter((o) => sortedIds.has(o.id));

  return NextResponse.json({
    orders: enrichedSorted,
    allOrders: enrichedActive,
    closedOrders: enrichedClosed,
    buckets,
  });
}
