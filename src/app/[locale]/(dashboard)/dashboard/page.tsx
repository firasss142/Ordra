import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { StoreDashboard } from "@/components/dashboard/home/StoreDashboard";

export const dynamic = "force-dynamic";

/**
 * /dashboard — Accueil « vos boutiques » (prototypes/dashboard-v2.html,
 * plans/dashboard-redesign.md): how the period went, store by store.
 * Owner and market managers; managers read it on their own market, without money.
 */
export default async function DashboardPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return (
    <StoreDashboard
      marketId={marketId}
      marketName={code ? tNav(`markets.${code}`) : ""}
      userName={(user.full_name ?? "").trim().split(/\s+/)[0] ?? ""}
      locale={params.locale}
      tz={marketTimezone(marketId)}
    />
  );
}
