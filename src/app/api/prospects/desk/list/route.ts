import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { parseListQuery, toDeskRow } from "@/lib/prospects/desk/list";
import { deskListQuery } from "@/lib/prospects/desk/query";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/prospects/desk/list — « La liste » of the manager's page.
 * Multi-select sources (`src`) and agents (`agent`, "none" = no agent), a
 * state, a name-or-phone search, 25 a page, the exact total. RLS on `leads`
 * is the isolation; the market filter only picks the slice.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const params = req.nextUrl.searchParams;
  const m = deskMarket(actorResult.actor, params.get("market_id"));
  if ("response" in m) return m.response;

  const q = parseListQuery(params);
  const supabase = await createClient();
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await deskListQuery(supabase as never, m.marketId, q, { count: true }).range(from, from + q.pageSize - 1);
  if (error) {
    console.error("[api/prospects/desk/list] query failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const now = new Date();
  return NextResponse.json({
    rows: ((data ?? []) as Record<string, unknown>[]).map((r) => toDeskRow(r, now)),
    total: count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  });
}

export const GET = withRouteErrors("/api/prospects/desk/list", "GET", handleGET);
