import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUsePurchases } from "@/lib/finance-permissions";
import { loadPurchasesPage } from "@/lib/finance/purchases/load";
import { LY_MARKET_ID } from "@/lib/markets";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/purchases?market_id=&locale= — Finances › Achats
 * (prototypes/finances-achats-v1.html): what the market owes, to whom and by
 * when; the arrivals waiting to be settled; the open purchase orders; the
 * suppliers.
 *
 * THE OWNER AND MARKET MANAGERS (owner decision, plans/finances-redesign.md).
 * The market comes from the actor for a manager — a `market_id` in the URL is
 * ignored, so a manager never reads another market even before RLS says no. A
 * super_admin has no market (both production accounts carry NULL) and names
 * one. Every write the page makes goes through the existing routes and RPCs,
 * which check the same two roles and the market again.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canUsePurchases(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }
  const locale = req.nextUrl.searchParams.get("locale") === "ar" ? "ar" : "fr";

  const supabase = await createClient();
  let view;
  try {
    view = await loadPurchasesPage(supabase, { marketId, role: actor.role, actorMarketId: actor.market_id ?? null, locale });
  } catch (e) {
    // Never an empty « nothing owed »: an unreadable ledger is an error.
    return NextResponse.json({ error: e instanceof Error ? e.message : "load_failed" }, { status: 500 });
  }

  return NextResponse.json({ ...view, marketId, currency: marketId === LY_MARKET_ID ? "LYD" : "TND" });
}

/*
 * Every handler goes through `withRouteErrors`, or its 500s never reach
 * Journaux › « Ordra — erreurs et sécurité ». A repo test (`routes-are-wrapped`)
 * refuses any route exporting a bare handler.
 */
export const GET = withRouteErrors("/api/finance/purchases", "GET", handleGET);
