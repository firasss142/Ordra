import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { marketIdToCode } from "@/lib/markets";
import { StockPage } from "@/components/finance/stock/StockPage";

export const dynamic = "force-dynamic";

/**
 * Finances › Stock & inventaire — prototypes/finances-stock-v1.html,
 * plans/finances-redesign.md: the money asleep in stock and what to rebuy,
 * one block per warehouse. Units, counts and movements stay in Entrepôt › Stock.
 */
export default async function InventoryPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") redirect(`/${params.locale}/queue`);
  if (!canViewFinanceSection(user.role)) redirect(`/${params.locale}/dashboard`);

  const { marketId } = await getActiveMarketScope(user);
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return <StockPage marketId={marketId} marketName={code ? tNav(`markets.${code}`) : tNav("markets.all")} locale={params.locale} />;
}
