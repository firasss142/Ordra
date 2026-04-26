import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortAgentQueue } from "@/lib/orders/queue-sort";
import { getActor } from "@/lib/auth/actor";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";

const ACTIVE_QUEUE_STATUSES = [
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
  "confirmed",
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
      .select("*")
      .eq("assigned_to", actor.id)
      .in("status", ACTIVE_QUEUE_STATUSES),
    supabase
      .from("orders")
      .select("*")
      .eq("assigned_to", actor.id)
      .in("status", CLOSED_STATUSES)
      .gte("updated_at", closedSince.toISOString())
      .order("updated_at", { ascending: false }),
  ]);

  if (activeRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const allOrders = activeRes.data ?? [];
  const closedOrders = closedRes.data ?? [];

  const activeOrders = allOrders.filter((o) => {
    if (o.status === "confirmed") return false;
    if (o.status === "callback_scheduled") {
      return o.callback_scheduled_at && new Date(o.callback_scheduled_at) <= now;
    }
    if (o.status === "dispatch_scheduled") {
      // Auto-dispatch rows never surface in the agent's queue —
      // the cron promotes them. Manual rows re-surface only when the
      // scheduled time has arrived.
      if (o.scheduled_dispatch_auto) return false;
      return o.scheduled_dispatch_at && new Date(o.scheduled_dispatch_at) <= now;
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

  for (const o of allOrders) {
    const s = o.status as string;
    if (s === "assigned") buckets.nouveau++;
    else if (s === "attempt_1") {
      buckets.tentative_1++;
      buckets.tentative_total++;
    } else if (s === "attempt_2") {
      buckets.tentative_2++;
      buckets.tentative_total++;
    } else if (s === "attempt_3") {
      buckets.tentative_3++;
      buckets.tentative_total++;
    } else if (s === "callback_scheduled") {
      const cbAt = o.callback_scheduled_at as string | null;
      if (!cbAt || new Date(cbAt) > now) buckets.rappel_prevu++;
    } else if (s === "dispatch_scheduled") {
      // Count every dispatch_scheduled row (auto + manual, future only)
      // in the Livraison sub-chip. Once past the scheduled time, manual
      // rows move into the normal active list; auto rows disappear the
      // moment the cron promotes them to dispatched.
      const dAt = o.scheduled_dispatch_at as string | null;
      if (!dAt || new Date(dAt) > now) buckets.livraison_planifiee++;
    } else if (s === "confirmed") buckets.confirme++;
  }

  for (const o of closedOrders) {
    if (o.status === "rejected") buckets.rejete++;
  }

  const sortedIds = new Set(sorted.map((o) => o.id));
  const allSorted = [...sorted, ...allOrders.filter((o) => !sortedIds.has(o.id))];

  // Enrich with repeat-buyer signals across the visible queue + closed list.
  const enrichedActive = await enrichRowsWithCustomerHistory(
    supabase,
    actor.market_id ?? null,
    "order",
    allSorted,
  );
  const enrichedClosed = await enrichRowsWithCustomerHistory(
    supabase,
    actor.market_id ?? null,
    "order",
    closedOrders,
  );

  const enrichedSorted = enrichedActive.filter((o) => sortedIds.has(o.id));

  return NextResponse.json({
    orders: enrichedSorted,
    allOrders: enrichedActive,
    closedOrders: enrichedClosed,
    buckets,
  });
}
