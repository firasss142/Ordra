import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { WarehouseOverviewClient } from "@/components/warehouse/WarehouseOverviewClient";
import { AgentDashboard } from "@/components/warehouse/mobile/AgentDashboard";
import { createClient } from "@/lib/supabase/server";

/** Used only until a market sets `goal_daily_scanned`. */
const DEFAULT_DAILY_GOAL = 40;

export const dynamic = "force-dynamic";

export default async function WarehouseOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);

  if (!canScanWarehouse(user.role)) {
    redirect(`/${locale}/queue`);
  }

  /*
   * The agent's home screen is the mobile dashboard (mockup 01). It used to
   * redirect straight to Préparation because the desk overview was unusable
   * on a phone and told an agent nothing about their own day; now the tab
   * exists and has somewhere to land.
   */
  if (user.role === "warehouse_agent") {
    const { marketId: agentScope } = await getActiveMarketScope(user);
    const supabase = await createClient();
    const [summary, { data: goalRow }] = await Promise.all([
      getWarehouseSummary({
        role: user.role,
        actorMarketId: user.market_id,
        marketId: null,
      }),
      supabase
        .from("settings")
        .select("value")
        .eq("market_id", agentScope)
        .eq("key", "goal_daily_scanned")
        .maybeSingle(),
    ]);

    const raw = (goalRow?.value ?? null) as unknown;
    const unwrapped = typeof raw === "string" ? raw : raw === null ? null : String(raw);
    const dailyGoal =
      Number.isFinite(Number(unwrapped)) && Number(unwrapped) > 0
        ? Number(unwrapped)
        : DEFAULT_DAILY_GOAL;

    return <AgentDashboard summary={summary} dailyGoal={dailyGoal} locale={locale} />;
  }

  /*
   * The topbar switcher is the one that decides. This page used to force
   * "all" for super-admins, so the header said "Libye" while the figures
   * summed both markets — 50 Tunisian returns under a Libyan heading.
   */
  const isSuperAdmin = user.role === "super_admin";
  const { marketId: scopeMarketId } = await getActiveMarketScope(user);
  const initialMarketId: string | "all" | null = isSuperAdmin
    ? (scopeMarketId ?? "all")
    : user.market_id;

  const initialSummary = await getWarehouseSummary({
    role: user.role,
    actorMarketId: user.market_id,
    marketId: isSuperAdmin ? (scopeMarketId ?? "all") : null,
  });

  return (
    <WarehouseOverviewClient
      user={user}
      locale={locale}
      initialSummary={initialSummary}
      initialMarketId={initialMarketId}
    />
  );
}
