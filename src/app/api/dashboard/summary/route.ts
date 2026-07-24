import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { getDashboardSummary, stripFinancials } from "@/lib/dashboard/summary";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent" || actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = todayISO();
  const normalizeDate = (d: string | null) => (!d || d === "today" ? today : d);
  const fromDate = normalizeDate(req.nextUrl.searchParams.get("from_date"));
  const toDate = normalizeDate(req.nextUrl.searchParams.get("to_date"));
  const marketIdParam = req.nextUrl.searchParams.get("market_id");

  const summary = await getDashboardSummary({
    fromDate,
    toDate,
    marketId: actor.role === "super_admin" ? marketIdParam ?? "all" : null,
    role: actor.role,
    actorMarketId: actor.market_id,
  });

  const payload = canViewFinanceSection(actor.role) ? summary : stripFinancials(summary);

  return NextResponse.json(
    { data: payload },
    { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=55" } },
  );
}
