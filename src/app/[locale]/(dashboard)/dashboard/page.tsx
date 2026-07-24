import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";
import { getServerUser } from "@/lib/auth/server-user";
import { getDashboardSummary, stripFinancials } from "@/lib/dashboard/summary";
import { canViewFinanceSection } from "@/lib/finance-permissions";
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
  const initialPeriod = { from_date: today, to_date: today };

  const markets = user.role === "super_admin" ? await getAllActiveMarkets() : [];
  const defaultMarketId = getDefaultMarketId(markets);
  const initialMarketId =
    user.role === "super_admin" ? (defaultMarketId || "all") : (user.market_id ?? "");

  // Server-fetch Tunisia-scoped summary for super_admin (single-market = N× faster
  // than "all") and pass as fallbackData so the client paints with zero network call.
  const rawSummary = await getDashboardSummary({
    fromDate: today,
    toDate: today,
    marketId: user.role === "super_admin" ? (defaultMarketId || "all") : null,
    role: user.role,
    actorMarketId: user.market_id,
  });

  // Role-gate financials server-side before sending to client.
  const initialSummary = canViewFinanceSection(user.role)
    ? rawSummary
    : stripFinancials(rawSummary);

  return (
    <DashboardClient
      user={user}
      initialPeriod={initialPeriod}
      initialSummary={initialSummary}
      initialMarketId={initialMarketId}
    />
  );
}
