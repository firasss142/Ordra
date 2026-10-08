// GET /api/dashboard/stores?market_id=…&period=today|7d|30d|90d|month|m:YYYY-MM|custom&from=&to=
//
// Accueil « vos boutiques » (prototypes/dashboard-v2.html, plans/dashboard-redesign.md):
// the orders RECEIVED in the period, followed to today, store by store — every
// block of the page computed here, server-side, by lib/dashboard/stores/build.ts.
// Money goes to super_admin (the owner) only; a market manager reads the same
// page on their own market without a single price.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { marketTimezone } from "@/lib/markets";
import { parseDashState } from "@/lib/dashboard/stores/period";
import { loadStoreDash } from "@/lib/dashboard/stores/load";
import { buildStoreDash } from "@/lib/dashboard/stores/build";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const READERS = new Set(["super_admin", "market_manager"]);

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!READERS.has(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // super_admin names the market; a manager is pinned to their own whatever
  // they send. The RPC enforces the same rule a second time in SQL.
  const marketId = actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });

  const supabase = await createClient();
  const input = await loadStoreDash(
    supabase as unknown as Parameters<typeof loadStoreDash>[0],
    marketId,
    marketTimezone(marketId),
    parseDashState(req.nextUrl.searchParams),
    actor.role === "super_admin",
  );
  return NextResponse.json(buildStoreDash(input), {
    headers: { "Cache-Control": "private, no-cache" },
  });
}

export const GET = withRouteErrors("/api/dashboard/stores", "GET", handleGET);
