import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketTimezone } from "@/lib/markets";
import { TeamPerformanceWorkspace } from "@/components/team/control-room/TeamPerformanceWorkspace";

export const dynamic = "force-dynamic";

/** /team/performance — the period review: débit × taux, goals, presence. */
export default async function TeamPerformancePage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());

  return (
    <div className="min-h-screen bg-surface-page px-[30px] pb-[60px] pt-[26px]">
      <TeamPerformanceWorkspace marketId={marketId} locale={params.locale} tz={marketTimezone(marketId)} role={user.role} />
    </div>
  );
}
