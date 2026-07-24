import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";
import { getServerUser } from "@/lib/auth/server-user";
import { getDashboardSummary, stripFinancials } from "@/lib/dashboard/summary";
import { canViewFinanceSection } from "@/lib/finance-permissions";
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

  const today = new Date().toISOString().slice(0, 10);
  const initialPeriod = { from_date: today, to_date: today };

  // Honor the scope cookie so the server-rendered fallbackData key matches the
  // client's mount key for every cookie state (tn / ly / all / absent) — the
  // client then paints with zero duplicate network call.
  const activeScope = user.role === "super_admin" ? await getActiveMarketScope(user) : null;
  const initialMarketId =
    user.role === "super_admin"
      ? (activeScope!.scope === "all" ? "all" : activeScope!.marketId ?? "all")
      : (user.market_id ?? "");

  const rawSummary = await getDashboardSummary({
    fromDate: today,
    toDate: today,
    marketId: user.role === "super_admin" ? initialMarketId : null,
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
