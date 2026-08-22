import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { WarehouseOverviewClient } from "@/components/warehouse/WarehouseOverviewClient";

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

  // Warehouse agents don't see the overview — they jump straight to the queue.
  if (user.role === "warehouse_agent") {
    redirect(`/${locale}/warehouse/preparation`);
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
