import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";
import { getServerUser } from "@/lib/auth/server-user";
import { getDashboardSummary } from "@/lib/dashboard/summary";

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
  const initialPeriod = { from_date: today, to_date: today };

  // Server-fetch the initial summary so the first paint has data.
  // Market-manager = locked to their market; super_admin = all markets by default.
  const initialSummary = await getDashboardSummary({
    fromDate: today,
    toDate: today,
    marketId: user.role === "super_admin" ? "all" : null,
    role: user.role,
    actorMarketId: user.market_id,
  });

  // Role-gate financials server-side before sending to client.
  if (user.role !== "super_admin") {
    initialSummary.kpis.revenue = null;
    initialSummary.kpis.netProfit = null;
    initialSummary.footer.adSpend = null;
    initialSummary.markets = [];
  }

  return (
    <DashboardClient
      user={user}
      initialPeriod={initialPeriod}
      initialSummary={initialSummary}
    />
  );
}
