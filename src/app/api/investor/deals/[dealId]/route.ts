import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { buildDealCard, loadInvestorDeals } from "@/lib/investors/portfolio-summary";
import { addDaysISO } from "@/lib/investors/facts/ad-spend-daily";

export const dynamic = "force-dynamic";

type Range = "1w" | "1m" | "3m" | "period" | "all";
function rangeStart(range: Range, today: string, dealStart: string, lastStatementEnd: string | null): string {
  if (range === "all") return dealStart;
  if (range === "period") return lastStatementEnd ? addDaysISO(lastStatementEnd, 1) : dealStart;
  const days = range === "1w" ? 6 : range === "1m" ? 30 : 91;
  const s = addDaysISO(today, -days);
  return s < dealStart ? dealStart : s;
}

/** One deal: card + terms + statements + full waterfall + range-filtered series. */
export async function GET(req: NextRequest, { params }: { params: { dealId: string } }) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  const rangeParam = (req.nextUrl.searchParams.get("range") ?? "all") as Range;
  const range: Range = ["1w", "1m", "3m", "period", "all"].includes(rangeParam) ? rangeParam : "all";
  try {
    const { deals, terms, snapshots, statements } = await loadInvestorDeals(g.admin, g.actor.id);
    const deal = deals.find((d) => d.id === params.dealId);
    if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const snap = snapshots.get(deal.id);
    const dealStatements = statements.filter((s) => s.deal_id === deal.id);
    const card = buildDealCard(deal, terms.get(deal.id) ?? [], snap, dealStatements, g.today);
    const from = rangeStart(range, g.today, deal.start_date, card.last_statement_end);
    const series = (snap?.series ?? []).filter((r) => r.d >= from);
    return NextResponse.json(
      {
        data: {
          card,
          terms: terms.get(deal.id) ?? [],
          range,
          range_from: from,
          series,
          totals: snap?.totals ?? null,
          yours: snap?.yours ?? null,
          statements: dealStatements,
          payouts: dealStatements.filter((s) => s.payable > 0).map((s) => ({ date: s.period_end, amount: s.payable, statement_id: s.id })),
          as_of: snap?.as_of ?? null,
        },
      },
      { headers: INVESTOR_CACHE },
    );
  } catch (e) {
    console.error("[GET /api/investor/deals/[dealId]]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
