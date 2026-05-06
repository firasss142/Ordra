import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

const QUEUE_STATUSES = [
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
];

function getQueuePriority(
  status: string,
  callbackScheduledAt: string | null
): number {
  if (
    status === "callback_scheduled" &&
    callbackScheduledAt &&
    new Date(callbackScheduledAt) <= new Date()
  ) {
    return 0;
  }
  if (status === "attempt_1" || status === "attempt_2" || status === "attempt_3") {
    return 1;
  }
  if (status === "pending" || status === "assigned") {
    return 2;
  }
  if (status === "callback_scheduled") {
    return 3;
  }
  if (status === "confirmed") {
    return 4;
  }
  return 5;
}

function secondarySort(
  a: { status: string; callback_scheduled_at: string | null; created_at: string },
  b: { status: string; callback_scheduled_at: string | null; created_at: string }
): number {
  if (a.status === "callback_scheduled" && b.status === "callback_scheduled") {
    // Null callback_scheduled_at sorts to bottom (not epoch 0)
    if (!a.callback_scheduled_at && !b.callback_scheduled_at) return 0;
    if (!a.callback_scheduled_at) return 1;
    if (!b.callback_scheduled_at) return -1;
    return new Date(a.callback_scheduled_at).getTime() - new Date(b.callback_scheduled_at).getTime();
  }
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch queue orders and today's stats in parallel
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const [ordersResult, statsResult] = await Promise.all([
    // Queue orders
    supabase
      .from("orders")
      .select("*")
      .eq("assigned_to", actor.id)
      .in("status", QUEUE_STATUSES),

    // Today's stats from order_history (assigned + actioned statuses)
    supabase
      .from("order_history")
      .select("order_id, status_to")
      .eq("actor_id", actor.id)
      .gte("created_at", todayISO)
      .in("status_to", ["confirmed", "uploaded", "rejected"]),
  ]);

  if (ordersResult.error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  // Application-layer priority sort
  const sorted = [...(ordersResult.data ?? [])].sort((a, b) => {
    const pa = getQueuePriority(a.status, a.callback_scheduled_at);
    const pb = getQueuePriority(b.status, b.callback_scheduled_at);
    if (pa !== pb) return pa - pb;
    return secondarySort(a, b);
  });

  // Compute stats
  const historyRows = statsResult.data ?? [];
  const actionedOrderIds = new Set(
    historyRows
      .filter((r) => r.status_to === "confirmed" || r.status_to === "uploaded" || r.status_to === "rejected")
      .map((r) => r.order_id)
  );
  const confirmedOrderIds = new Set(
    historyRows
      .filter((r) => r.status_to === "confirmed" || r.status_to === "uploaded")
      .map((r) => r.order_id)
  );

  const assigned_today = (ordersResult.data ?? []).length;
  const actioned_today = actionedOrderIds.size;
  const confirmed_today = confirmedOrderIds.size;
  const confirmation_rate =
    actioned_today > 0
      ? Math.round((confirmed_today / actioned_today) * 100)
      : 0;

  return NextResponse.json({
    data: sorted,
    stats: {
      assigned_today,
      actioned_today,
      confirmation_rate,
    },
  });
}
