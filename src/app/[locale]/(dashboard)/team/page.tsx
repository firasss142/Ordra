import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { marketTimezone } from "@/lib/markets";
import { ControlRoom } from "@/components/team/room/ControlRoom";

export const dynamic = "force-dynamic";

/**
 * /team — Salle de contrôle (prototypes/team-v6.html). The day, then the agents
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
    // « Aurore »: the soft gradient ground and the page's tokens (globals.css, Salle de contrôle v6)
    <div className="r6 r6-main">
      <ControlRoom marketId={marketId} locale={params.locale} tz={marketTimezone(marketId)} role={user.role} />
    </div>
  );
}
