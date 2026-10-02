import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { daysBetween, isIsoDay } from "@/lib/feedback/date-range";
import { loadFamilies } from "@/lib/feedback/server-data";
import { marketTimezone } from "@/lib/markets";

export const dynamic = "force-dynamic";

/** Two calendar months, with room to spare. */
const MAX_SPAN = 70;

/**
 * GET /api/feedback/days?from&to&family — the days that have validated feedback, for the dots
 * under the date picker's calendar (prototype v6). The two months on screen, nothing more.
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canManageFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const market = resolveFeedbackMarket(result.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in market) return market.response;

  const p = req.nextUrl.searchParams;
  const from = p.get("from");
  const to = p.get("to");
  if (!isIsoDay(from) || !isIsoDay(to) || from > to || daysBetween(from, to) > MAX_SPAN) {
    return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  }

  const supabase = await createClient();
  const familyParam = p.get("family");
  const family = familyParam ? (await loadFamilies(supabase, market.marketId)).families.find((f) => f.id === familyParam) ?? null : null;
  const { data, error } = await supabase.rpc("feedback_cube", {
    p_market_id: market.marketId, p_from: from, p_to: to, p_tz: marketTimezone(market.marketId),
  });
  if (error) {
    console.error("[api/feedback/days]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const ids = family ? new Set(family.productIds) : null;
  const days = [...new Set(((data ?? []) as { day: string; product_id: string | null }[])
    .filter((r) => !ids || (r.product_id !== null && ids.has(r.product_id)))
    .map((r) => r.day))].sort();
  return NextResponse.json({ data: days });
}
