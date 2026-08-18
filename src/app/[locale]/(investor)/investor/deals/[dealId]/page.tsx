import { notFound, redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { marketTimezone } from "@/lib/markets";
import { localDateISO } from "@/lib/investors/facts/order-facts";
import { buildDealCard, loadInvestorDeals } from "@/lib/investors/portfolio-summary";
import { DealClient } from "@/components/investor/DealClient";

export const dynamic = "force-dynamic";

export default async function InvestorDealPage({ params }: { params: { locale: string; dealId: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);
  const admin = createAdminClient();
  const today = localDateISO(new Date().toISOString(), marketTimezone(user.market_id));
  const { deals, terms, snapshots, statements } = await loadInvestorDeals(admin, user.id);
  const deal = deals.find((d) => d.id === params.dealId);
  if (!deal) notFound();
  const snap = snapshots.get(deal.id);
  const dealStatements = statements.filter((s) => s.deal_id === deal.id);
  const card = buildDealCard(deal, terms.get(deal.id) ?? [], snap, dealStatements, today);
  const initial = {
    card,
    terms: terms.get(deal.id) ?? [],
    range: "all" as const,
    range_from: deal.start_date,
    series: snap?.series ?? [],
    totals: snap?.totals ?? null,
    yours: snap?.yours ?? null,
    statements: dealStatements,
    payouts: dealStatements.filter((s) => s.payable > 0).map((s) => ({ date: s.period_end, amount: s.payable, statement_id: s.id })),
    as_of: snap?.as_of ?? null,
  };
  return <DealClient dealId={deal.id} initial={initial} locale={params.locale} />;
}
