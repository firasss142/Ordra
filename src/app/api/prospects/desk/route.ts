import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { marketTimezone } from "@/lib/markets";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** The month the market is living in, as YYYY-MM. */
function currentMonth(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

/**
 * GET /api/prospects/desk?month=YYYY-MM — the facts behind the manager's
 * Prospects page, in one RPC (get_prospect_desk). The view model is built in
 * the browser by lib/prospects/desk/model.ts; this route only resolves the
 * market, the month and the timezone.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const m = deskMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in m) return m.response;

  const tz = marketTimezone(m.marketId);
  const raw = req.nextUrl.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : currentMonth(tz);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_prospect_desk", {
    p_market_id: m.marketId,
    p_month: `${month}-01`,
    p_tz: tz,
  });
  if (error) {
    console.error("[api/prospects/desk] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const GET = withRouteErrors("/api/prospects/desk", "GET", handleGET);
