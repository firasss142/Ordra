import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";
import { getServerUser } from "@/lib/auth/server-user";
import { getDashboardHealth, PERIOD_DAYS } from "@/lib/dashboard/health";
import { getLatestActivityDateCached } from "@/lib/dashboard/latest-activity";
import { lastNDaysPeriod } from "@/lib/date";
import { getActiveMarketScope } from "@/lib/auth/market-scope";

export default async function DashboardPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role === "agent" || user.role === "warehouse_agent") {
    redirect(`/${params.locale}/queue`);
  }

  // Render the market the user actually has selected, read from the same
  // oms_scope_market cookie the sidebar switcher writes. Using a hardcoded
  // default here would server-render the wrong market and force the client to
  // discard it and refetch — which also breaks the fallbackData guard.
  const activeScope = await getActiveMarketScope(user);
  const scopeMarketId = activeScope.marketId ?? "all";
  const initialMarketId =
    user.role === "super_admin" ? scopeMarketId : (user.market_id ?? "");

  // One fixed window. There is no period selector any more, and deliberately no
  // silent re-anchoring: the old page shifted to a 30-day window ending in the
  // past while the tab still read "30 jours", which made every delta look
  // catastrophic. If this window is empty we say so instead.
  const period = lastNDaysPeriod(PERIOD_DAYS);

  const ssrMarketId =
    user.role === "super_admin" ? scopeMarketId : (user.market_id ?? null);

  const initialHealth = await getDashboardHealth({
    fromDate: period.from_date,
    toDate: period.to_date,
    marketId: user.role === "super_admin" ? scopeMarketId : null,
    role: user.role,
    actorMarketId: user.market_id,
  });

  // Only look up the last activity date when there is genuinely nothing in the
  // window — otherwise this is a wasted (cached) query on every render.
  const windowIsEmpty = initialHealth.funnel.leads.current === 0;
  const lastActivity = windowIsEmpty
    ? await getLatestActivityDateCached(ssrMarketId)
    : null;

  return (
    <DashboardClient
      user={user}
      period={period}
      initialHealth={initialHealth}
      initialMarketId={initialMarketId}
      lastActivity={lastActivity}
    />
  );
}
