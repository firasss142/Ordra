import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { getDashboardHealth } from "@/lib/dashboard/health";
import { todayInMarket } from "@/lib/dates/market-day";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent" || actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketIdParam = req.nextUrl.searchParams.get("market_id");
  // "today" is the market's calendar day, not the server's UTC one — the same
  // scope resolution getDashboardHealth applies, so the default period and the
  // RPC's zone name the same day.
  const scopedForToday =
    actor.role === "super_admin"
      ? marketIdParam && marketIdParam !== "all" ? marketIdParam : null
      : actor.market_id;
  const today = todayInMarket(scopedForToday);
  const normalizeDate = (d: string | null) => (!d || d === "today" ? today : d);
  const fromDate = normalizeDate(req.nextUrl.searchParams.get("from_date"));
  const toDate = normalizeDate(req.nextUrl.searchParams.get("to_date"));

  // Financial role gating happens inside getDashboardHealth (money block is
  // nulled and markets emptied for non-super_admin), so unlike the old summary
  // route there is no second, drift-prone copy of the rule here.
  const health = await getDashboardHealth({
    fromDate,
    toDate,
    marketId: actor.role === "super_admin" ? marketIdParam ?? "all" : null,
    role: actor.role,
    actorMarketId: actor.market_id,
  });

  return NextResponse.json(
    { data: health },
    // Period-scoped figures change slowly; the client polls at 5 min and the
    // realtime mutate() now targets /queues instead of this route.
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } },
  );
}
