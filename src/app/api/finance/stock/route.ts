import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { DEMAND_WINDOW_OPTIONS, DEFAULT_DEMAND_WINDOW, type DemandWindowDays } from "@/lib/inventory/stock-position-types";
import { loadStockPage } from "@/lib/finance/stock/load";
import { LY_MARKET_ID } from "@/lib/markets";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/stock?market_id=&window=7|28|90 — Stock & inventaire
 * (prototypes/finances-stock-v1.html): the money in stock at purchase price,
 * one block per warehouse, what sleeps and what to rebuy.
 */
async function handleGET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });

  const raw = req.nextUrl.searchParams.get("window");
  const windowDays = raw === null ? DEFAULT_DEMAND_WINDOW : (Number(raw) as DemandWindowDays);
  if (!DEMAND_WINDOW_OPTIONS.includes(windowDays)) return NextResponse.json({ error: "Invalid window" }, { status: 400 });

  const data = await loadStockPage(supabase, { marketId, windowDays, role: actor.role, actorMarketId: actor.market_id ?? null });
  return NextResponse.json({ ...data, currency: marketId === LY_MARKET_ID ? "LYD" : "TND" });
}

export const GET = withRouteErrors("/api/finance/stock", "GET", handleGET);
