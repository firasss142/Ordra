import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { PerformanceOrders } from "@/components/performance/orders/PerformanceOrders";

export const dynamic = "force-dynamic";

/**
 * /performance/orders — Performance › Commandes (prototypes/performance-commandes-v4.html,
 * plans/performance-commandes.md): where the orders received in a period got lost.
 * Owner and market managers; managers read it on their own market, without money.
 */
export default async function PerformanceOrdersPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return (
    <PerformanceOrders
      marketId={marketId}
      marketName={code ? tNav(`markets.${code}`) : ""}
      locale={params.locale}
      tz={marketTimezone(marketId)}
    />
  );
}
