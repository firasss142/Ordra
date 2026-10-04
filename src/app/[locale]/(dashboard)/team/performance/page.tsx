import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { TeamPerformance } from "@/components/team/performance/TeamPerformance";

export const dynamic = "force-dynamic";

/**
 * /team/performance — Performance › Équipe (prototypes/team-performance-v3.html,
 * plans/team-performance-redesign.md): why do agents lose orders?
 * Owner and market managers; managers read it on their own market.
 */
export default async function TeamPerformancePage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });

  return (
    <TeamPerformance
      marketId={marketId}
      marketName={code ? tNav(`markets.${code}`) : ""}
      locale={params.locale}
      tz={marketTimezone(marketId)}
    />
  );
}
