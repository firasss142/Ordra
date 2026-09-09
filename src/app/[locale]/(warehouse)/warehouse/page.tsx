import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { WarehouseOverviewClient } from "@/components/warehouse/WarehouseOverviewClient";
import { BenchHome } from "@/components/warehouse/bench/BenchHome";
import { createClient } from "@/lib/supabase/server";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { zoneForOrder } from "@/lib/warehouse/zone-index";
import { attachProductImages } from "@/lib/warehouse/product-images";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";

const BENCH_PAGE_LIMIT = 200;

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
   * The agent's home is the bench: what waits, grouped by sticker roll. The
   * queue is prefetched server-side so the screen has parcels the moment it
   * paints; SWR takes over from there. No daily goal is read here any more:
   * the bench measures what waits, not what a manager hoped for.
   */
  if (user.role === "warehouse_agent") {
    const { marketId: agentScope, marketCode } = await getActiveMarketScope(user);
    const supabase = await createClient();
    // The agent's own building. Libya has two and they hold different parcels;
    // painting the market's whole queue first and correcting it a second later
    // would show a Benghazi agent 365 Tripoli parcels they cannot touch.
    const site = await resolveSiteFilter(supabase, { actor: user, requested: null });
    const [summary, { data }, zoneIndex] = await Promise.all([
      getWarehouseSummary({
        role: user.role,
        actorMarketId: user.market_id,
        marketId: null,
        warehouseId: site.warehouseId,
      }),
      supabase.rpc("get_to_label_orders", {
        p_market_id: agentScope,
        p_limit: BENCH_PAGE_LIMIT,
        p_cursor_created_at: null,
        p_cursor_id: null,
        p_warehouse_id: site.warehouseId,
      }),
      getZoneIndex(supabase),
    ]);
    const pictured = await attachProductImages(supabase, (data ?? []) as unknown as WarehouseOrderRow[]);
    const orders = pictured.map((row) => ({
      ...row,
      zone: zoneForOrder(row, zoneIndex),
    }));
    const market: "ly" | "tn" = marketCode === "ly" ? "ly" : "tn";
    return (
      <BenchHome
        market={market}
        locale={locale}
        currency={market === "ly" ? "LYD" : "TND"}
        initialOrders={orders}
        initialStats={{
          toPrepare: summary.queue.toPrepare,
          oldestHours: summary.queue.oldestPrepareHours,
          scannedToday: summary.day.scannedToday,
          toHandOver: summary.queue.toHandOver,
          carrierWarehouse: summary.queue.carrierWarehouse ?? 0,
        }}
      />
    );
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
