import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { marketTimezone } from "@/lib/markets";
import { localDateISO } from "@/lib/investors/facts/order-facts";
import { loadInvestorPortfolio } from "@/lib/investors/portfolio-summary";
import { PortfolioClient } from "@/components/investor/PortfolioClient";

export const dynamic = "force-dynamic";

/**
 * Investor home. The server loads the portfolio once (service role, id from
 * the session) and hands it to the client as SWR fallbackData on the same key
 * the client polls — no flash, no double fetch.
 */
export default async function InvestorHomePage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnPortfolio(user.role)) redirect(`/${params.locale}/dashboard`);
  const today = localDateISO(new Date().toISOString(), marketTimezone(user.market_id));
  const initial = await loadInvestorPortfolio(createAdminClient(), user.id, today);
  return <PortfolioClient initial={initial} locale={params.locale} today={today} />;
}
