import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketTimezone } from "@/lib/markets";
import { TeamLiveWorkspace } from "@/components/team/control-room/TeamLiveWorkspace";

export const dynamic = "force-dynamic";

/**
 * /team — Salle de contrôle. Who is working, what is moving, what is stuck —
 * right now, for one market. Managers see their own; super_admin sees the
 * scoped market (falls back to the default market when "all" is selected,
 * because a roster across markets is not a thing).
 */
export default async function TeamLivePage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());

  return (
    <div className="min-h-screen bg-surface-page px-[30px] pb-[60px] pt-[26px]">
      <TeamLiveWorkspace marketId={marketId} locale={params.locale} tz={marketTimezone(marketId)} role={user.role} />
    </div>
  );
}
