import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { BenchConsole } from "@/components/warehouse/console/BenchConsole";
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

    /*
     * Nobody has assigned this agent to a building. Rendering the market's queue
     * would mix Tripoli and Benghazi on one bench, and every scan would be
     * refused by the SQL guard anyway — so the screen explains itself instead of
     * offering work that cannot be done.
     */
    if (site.unassigned) {
      const market: "ly" | "tn" = marketCode === "ly" ? "ly" : "tn";
      return (
        <BenchHome
          market={market}
          locale={locale}
          currency={market === "ly" ? "LYD" : "TND"}
          initialOrders={[]}
          initialStats={{
            toPrepare: 0, oldestHours: 0, scannedToday: 0,
            toHandOver: 0, carrierWarehouse: 0,
          }}
          siteUnassigned
        />
      );
    }

    const [summary, { data }, zoneIndex, siteName] = await Promise.all([
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
      // The building's own name, in the market's language — it is a place name
      // painted on a wall, so it is never translated by key.
      site.warehouseId
        ? supabase
            .from("warehouses")
            .select("name_fr, name_ar")
            .eq("id", site.warehouseId)
            .maybeSingle<{ name_fr: string; name_ar: string }>()
            .then((r) => (marketCode === "ly" ? r.data?.name_ar : r.data?.name_fr) ?? null)
        : Promise.resolve(null),
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
        siteName={siteName}
      />
    );
  }

  /*
   * The manager's bench. This page used to be "Aujourd'hui", an overview that
   * repeated every figure Préparation, Retours and Stock already showed — and
   * whose "priority actions" were not clickable, because the parent never
   * passed the callbacks. It is now the same two questions the agent has: what
   * is there to prepare, and what happened to what we already scanned.
   *
   * The topbar switcher decides the market. This page used to force "all" for
   * super-admins, so the header said "Libye" while the figures summed both
   * markets — 50 Tunisian returns under a Libyan heading.
   */
  const { marketId: scope, marketCode } = await getActiveMarketScope(user);
  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, {
    actor: user,
    requested: null,
  });

  const [{ data }, zoneIndex, { data: goalRow }] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: scope,
      p_limit: BENCH_PAGE_LIMIT,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_warehouse_id: site.warehouseId,
    }),
    getZoneIndex(supabase),
    // The daily target is a market setting, never a constant in the component.
    supabase
      .from("settings")
      .select("value")
      .eq("market_id", scope)
      .eq("key", "goal_daily_scanned")
      .maybeSingle<{ value: unknown }>(),
  ]);

  // Settings are stored both as a bare value and as { value }, depending on
  // when the row was written. Read both shapes rather than trusting one.
  const raw = goalRow?.value;
  const unwrapped =
    raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw;
  // Null, not a default: a goal the market never set is not a goal of 40.
  const dailyGoal =
    Number.isFinite(Number(unwrapped)) && Number(unwrapped) > 0 ? Number(unwrapped) : null;

  const deskOrders = ((data ?? []) as unknown as WarehouseOrderRow[]).map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  /*
   * What gets scanned differs by market: Libya scans Darb's pre-printed
   * sticker, which the OMS cannot resolve on its own, so the operator picks the
   * row first. Tunisia scans the QR on our own label, which IS the order id.
   */
  const deskMarket: "ly" | "tn" = marketCode === "ly" ? "ly" : "tn";

  return (
    <BenchConsole
      market={deskMarket}
      initialOrders={deskOrders}
      dailyGoal={dailyGoal}
      warehouseId={site.warehouseId}
    />
  );
}
