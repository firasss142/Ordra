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

export async function GET(_req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(_req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const [historyResult, ordersResult] = await Promise.all([
    supabase
      .from("order_history")
      .select("order_id, status_to")
      .eq("actor_id", actor.id)
      .gte("created_at", todayISO)
      .in("status_to", ["confirmed", "dispatched", "rejected"]),

    supabase
      .from("orders")
      .select("id")
      .eq("assigned_to", actor.id)
      .in("status", QUEUE_STATUSES),
  ]);

  if (historyResult.error || ordersResult.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const historyRows = historyResult.data ?? [];
  const assignedOrders = ordersResult.data ?? [];

  // Distinct order_ids actioned today
  const actionedOrderIds = new Set(historyRows.map((r) => r.order_id));
  const confirmedOrderIds = new Set(
    historyRows
      .filter((r) => r.status_to === "confirmed" || r.status_to === "dispatched")
      .map((r) => r.order_id)
  );

  const actioned_today = actionedOrderIds.size;
  const confirmed_today = confirmedOrderIds.size;
  const confirmation_rate =
    actioned_today > 0 ? Math.round((confirmed_today / actioned_today) * 100) : 0;

  return NextResponse.json({
    assigned_today: assignedOrders.length,
    actioned_today,
    confirmation_rate,
  });
}
