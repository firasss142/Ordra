import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/prospects/desk/cities — the cities « Affiner » offers: where the
 * market's customers live, most customers first. The old composer read them
 * from the page of prospects on screen, so a filtered list offered almost none.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const m = deskMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in m) return m.response;
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("last_city").eq("market_id", m.marketId).not("last_city", "is", null).limit(10000);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { last_city: string | null }[]) {
    const c = (r.last_city ?? "").trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const cities = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c]) => c);
  return NextResponse.json({ cities });
}

export const GET = withRouteErrors("/api/prospects/desk/cities", "GET", handleGET);
