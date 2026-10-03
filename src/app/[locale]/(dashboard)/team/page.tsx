import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketTimezone } from "@/lib/markets";
import { ControlRoom } from "@/components/team/room/ControlRoom";

export const dynamic = "force-dynamic";

/**
 * /team — Salle de contrôle (prototypes/team-v5.html). The day, then the agents
 * over a period, for one market. Managers see their own; super_admin sees the
 * scoped market (falls back to the default market when "all" is selected,
 * because a roster across markets is not a thing).
 */
export default async function TeamControlRoomPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);

  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = scoped ?? getDefaultMarketId(await getAllActiveMarkets());

  return (
    <div className="min-h-screen bg-surface-page px-[32px] pb-[64px] pt-[26px] max-[900px]:px-[14px] max-[900px]:pb-[40px] max-[900px]:pt-[16px]">
      <ControlRoom marketId={marketId} locale={params.locale} tz={marketTimezone(marketId)} role={user.role} />
    </div>
  );
}
