import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { marketIdToCode } from "@/lib/markets";
import { PnlPage } from "@/components/finance/pnl/PnlPage";

export const dynamic = "force-dynamic";

/**
 * Finances › P&L global — prototypes/finances-pnl-v3.html, plans/finances-redesign.md.
 * What the owner earned in a month: one answer, the pipe, Mois par mois.
 * One market at a time — « Tous les marchés » asks for one (each has its currency).
 */
export default async function ProfitabilityPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") redirect(`/${params.locale}/queue`);
  if (!canViewFinanceSection(user.role)) redirect(`/${params.locale}/dashboard`);

  const { marketId } = await getActiveMarketScope(user);
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return <PnlPage marketId={marketId} marketName={code ? tNav(`markets.${code}`) : tNav("markets.all")} locale={params.locale} />;
}
