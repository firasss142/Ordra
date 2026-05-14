import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const MAX_ITEMS = 200;

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const daysParam = req.nextUrl.searchParams.get("days");
  const parsedDays = daysParam ? parseInt(daysParam, 10) : DEFAULT_DAYS;
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, MAX_DAYS) : DEFAULT_DAYS;
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  let query = supabase
    .from("alert_acknowledgements")
    .select("id, alert_key, alert_type, entity_id, market_id, acknowledged_at, snoozed_until, actor_id, created_at, updated_at")
    .gte("created_at", cutoffIso)
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS);
  if (marketId) query = query.eq("market_id", marketId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ history: data ?? [], days });
}
