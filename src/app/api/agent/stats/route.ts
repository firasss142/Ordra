import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { marketDayStartUtc } from "@/lib/dates/market-day";
import { marketTimezone } from "@/lib/markets";

export const dynamic = "force-dynamic";

const QUEUE_STATUSES = [
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
];

async function handleGET(_req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(_req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // « aujourd'hui » is the market's day: Tripoli's midnight, not the server's (UTC on Vercel), which
  // made the meters reset at 02:00 local time and count the night before.
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: marketTimezone(actor.market_id), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const fallback = new Date();
  fallback.setHours(0, 0, 0, 0);
  const todayISO = marketDayStartUtc(localDay, actor.market_id) ?? fallback.toISOString();

  const [historyResult, ordersResult] = await Promise.all([
    supabase
      .from("order_history")
      .select("order_id, status_to")
      .eq("actor_id", actor.id)
      .gte("created_at", todayISO)
      .in("status_to", ["confirmed", "uploaded", "rejected"]),

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
      .filter((r) => r.status_to === "confirmed" || r.status_to === "uploaded")
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

export const GET = withRouteErrors("/api/agent/stats", "GET", handleGET);
