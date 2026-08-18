import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { loadInvestorPortfolio } from "@/lib/investors/portfolio-summary";

export const dynamic = "force-dynamic";

/** The investor home: hero per currency, value series, deal cards, unread count. */
export async function GET(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  try {
    const data = await loadInvestorPortfolio(g.admin, g.actor.id, g.today);
    return NextResponse.json({ data }, { headers: INVESTOR_CACHE });
  } catch (e) {
    console.error("[GET /api/investor/portfolio]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
