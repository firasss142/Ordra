import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveScorecardMarket } from "@/lib/carriers/scorecard/api-market";
import { SCORECARD_PERIODS, type Scorecard } from "@/lib/carriers/scorecard/types";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/carriers/scorecard?market_id=…&days=7|30|90
 * The Transporteurs page in one RPC round-trip (`get_carrier_scorecard`).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const scope = resolveScorecardMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in scope) return scope.response;

  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  if (!(SCORECARD_PERIODS as readonly number[]).includes(days)) {
    return NextResponse.json({ error: "days must be 7, 30 or 90" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_carrier_scorecard", {
    p_market_id: scope.marketId,
    p_days: days,
  });

  if (error) {
    console.error("[api/carriers/scorecard] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const card = (data ?? {}) as Scorecard;

  // Uploaded logos ride beside the RPC rather than inside it, so the RPC needs
  // no migration. A failed read only costs the uploads: the brand files stand in.
  const { data: logos, error: logoError } = await supabase.from("carriers").select("id, logo_url").eq("market_id", scope.marketId);
  if (logoError) console.error("[api/carriers/scorecard] logo read failed", logoError);
  const logoOf = new Map((logos ?? []).map((l: { id: string; logo_url: string | null }) => [l.id, l.logo_url]));
  if (Array.isArray(card.carriers)) card.carriers = card.carriers.map((c) => ({ ...c, logo_url: logoOf.get(c.id) ?? null }));
  if (Array.isArray(card.dormant)) card.dormant = card.dormant.map((c) => ({ ...c, logo_url: logoOf.get(c.id) ?? null }));

  return NextResponse.json({ data: card });
}

export const GET = withRouteErrors("/api/carriers/scorecard", "GET", handleGET);
