import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canUsePurchases } from "@/lib/finance-permissions";
import { marketIdToCode } from "@/lib/markets";
import { PurchasesPage } from "@/components/finance/purchases/PurchasesPage";

export const dynamic = "force-dynamic";

/**
 * Finances › Achats — prototypes/finances-achats-v1.html, plans/finances-redesign.md:
 * what the market owes, to whom and by when; the arrivals to settle; the open
 * purchase orders; the suppliers. The owner AND market managers (own market only —
 * a manager's scope is their market, never the cookie's).
 */
export default async function PurchasesRoute({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") redirect(`/${params.locale}/queue`);
  if (!canUsePurchases(user.role)) redirect(`/${params.locale}/dashboard`);

  const { marketId } = await getActiveMarketScope(user);
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return <PurchasesPage marketId={marketId} marketName={code ? tNav(`markets.${code}`) : tNav("markets.all")} locale={params.locale} />;
}
