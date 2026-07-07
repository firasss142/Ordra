import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";
import { getServerUser } from "@/lib/auth/server-user";
import { getDashboardSummary } from "@/lib/dashboard/summary";
import { getLatestActivityDateCached } from "@/lib/dashboard/latest-activity";
import { anchoredDefaultPeriod } from "@/lib/date";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";

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

  const today = new Date().toISOString().slice(0, 10);

  const markets = user.role === "super_admin" ? await getAllActiveMarkets() : [];
  const defaultMarketId = getDefaultMarketId(markets);
  const initialMarketId =
    user.role === "super_admin" ? (defaultMarketId || "all") : (user.market_id ?? "");

  // Anchor the initial period to the latest date that actually has revenue data
  // for the initial market. Seed/imported data can end well before today (e.g.
  // Tunisia fulfillment events stop in April), which would otherwise render an
  // empty "today" dashboard. When the latest data is in the past we show a 30-day
  // window ending there rather than one sparse day. The anchor market MUST equal
  // the market initialSummary is fetched for so the client's fallbackData/
  // initialKey match (no hydration miss).
  const ssrMarketId =
    user.role === "super_admin" ? (defaultMarketId || "all") : (user.market_id ?? null);
  const latestActivity = await getLatestActivityDateCached(ssrMarketId);
  const { period: initialPeriod, preset: initialPreset } = anchoredDefaultPeriod(
    today,
    latestActivity,
  );

  // Server-fetch the anchored single-market summary for super_admin (single-market
  // = N× faster than "all") and pass as fallbackData so the client paints with
  // zero network call.
  const initialSummary = await getDashboardSummary({
    fromDate: initialPeriod.from_date,
    toDate: initialPeriod.to_date,
    marketId: user.role === "super_admin" ? (defaultMarketId || "all") : null,
    role: user.role,
    actorMarketId: user.market_id,
  });

  // Role-gate financials server-side before sending to client.
  if (user.role !== "super_admin") {
    initialSummary.kpis.revenue = null;
    initialSummary.kpis.netProfit = null;
    initialSummary.footer.adSpend = null;
    initialSummary.markets = [];
    initialSummary.topProducts = initialSummary.topProducts.map((p) => ({ ...p, revenue: null }));
  }

  return (
    <DashboardClient
      user={user}
      initialPeriod={initialPeriod}
      initialPreset={initialPreset}
      initialSummary={initialSummary}
      initialMarketId={initialMarketId}
    />
  );
}
