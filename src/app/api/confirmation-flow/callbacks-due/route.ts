import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

const MAX_WITHIN_MINUTES = 240;
const DEFAULT_WITHIN_MINUTES = 30;
// Look back 5 min so just-overdue callbacks are still surfaced
const LOOKBACK_MINUTES = 5;

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const paramMarketId = params.get("market_id");

  let marketId: string;
  if (actor.role === "super_admin") {
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id is required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    if (!actor.market_id) {
      return NextResponse.json({ error: "Market not found for actor" }, { status: 400 });
    }
    marketId = actor.market_id;
  }

  const withinMinutesRaw = parseInt(params.get("within_minutes") ?? String(DEFAULT_WITHIN_MINUTES), 10);
  if (
    Number.isNaN(withinMinutesRaw) ||
    withinMinutesRaw < 1 ||
    withinMinutesRaw > MAX_WITHIN_MINUTES
  ) {
    return NextResponse.json(
      { error: `within_minutes must be between 1 and ${MAX_WITHIN_MINUTES}` },
      { status: 400 }
    );
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);
  const windowEnd = new Date(now.getTime() + withinMinutesRaw * 60_000);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, external_id, customer_name, callback_scheduled_at, assigned_to, users!orders_assigned_to_fkey(full_name)"
    )
    .eq("market_id", marketId)
    .eq("status", "callback_scheduled")
    .gte("callback_scheduled_at", windowStart.toISOString())
    .lte("callback_scheduled_at", windowEnd.toISOString())
    .order("callback_scheduled_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[GET /api/confirmation-flow/callbacks-due]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const nowIso = now.toISOString();

  const rows = (data ?? []).map((order) => {
    const callbackAt = new Date(order.callback_scheduled_at as string);
    const minutesUntil = Math.round((callbackAt.getTime() - now.getTime()) / 60_000);
    const agentUser = Array.isArray(order.users)
      ? (order.users[0] as { full_name: string } | undefined) ?? null
      : (order.users as { full_name: string } | null);

    return {
      order_id: order.id,
      external_id: (order.external_id as string | null) ?? null,
      customer_name: (order.customer_name as string) ?? "",
      callback_scheduled_at: order.callback_scheduled_at,
      minutes_until: minutesUntil,
      agent_id: (order.assigned_to as string | null) ?? null,
      agent_full_name: agentUser?.full_name ?? null,
    };
  });

  return NextResponse.json({ data: rows, now: nowIso });
}
