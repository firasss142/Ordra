import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewInvestorAdmin } from "@/lib/investor-permissions";
import { LY_MARKET_ID } from "@/lib/markets";
import { loadInvestorsPage } from "@/lib/finance/investors/load";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/investors?market_id= — Investisseurs
 * (prototypes/finances-investisseurs-v1.html): one card per person, closed
 * months only. The owner reads any market; a market manager reads their own,
 * whatever they ask for (same allow-list as /api/admin/investments/*).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewInvestorAdmin(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const marketId = actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });

  const data = await loadInvestorsPage(createAdminClient(), marketId);
  return NextResponse.json({ ...data, currency: marketId === LY_MARKET_ID ? "LYD" : "TND" });
}

export const GET = withRouteErrors("/api/finance/investors", "GET", handleGET);
