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
import { fetchDayLoopRows, marketToday } from "@/lib/warehouse/day-loop-server";
import { assembleDayLoop } from "@/lib/warehouse/day-loop-assemble";
import { deadCarrierBySite, foldSummary, type SetAsideRow } from "@/lib/warehouse/desk-sortir";

const BENCH_PAGE_LIMIT = 200;

export const dynamic = "force-dynamic";

export default async function WarehouseOutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  /** `?warehouse_id=` — the desk top bar's building switch. Ignored for an agent. */
  searchParams?: Promise<{ warehouse_id?: string }>;
}) {
  const { locale } = await params;
  const requestedSite = (await searchParams)?.warehouse_id ?? null;
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
   * The manager's Sortir — prototype `C.out`: the queue as one table grouped by
   * roll, « Prendre » puts a parcel in hand for the top bar's scan field, and
   * the parcels taken off the bench fold up underneath, per building.
   *
   * The building comes from the top bar's switch (`?warehouse_id=`); the
   * topbar's market scope decides the market. Figures come from the same
   * assembly as Aujourd'hui, so the two screens can never disagree.
   */
  const { marketId: scope, marketCode } = await getActiveMarketScope(user);
  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, { actor: user, requested: requestedSite });

  let setAsideQuery = supabase
    .from("orders")
    .select("warehouse_id, carrier_extra, carrier:carriers(name, is_active)")
    .eq("status", "uploaded")
    .not("bench_cleared_at", "is", null)
    .is("archived_at", null)
    .limit(5000);
  if (scope) setAsideQuery = setAsideQuery.eq("market_id", scope);

  const [{ data }, zoneIndex, dayRows, { data: setAsideRows }] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: scope,
      p_limit: BENCH_PAGE_LIMIT,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_warehouse_id: site.warehouseId,
    }),
    getZoneIndex(supabase),
    fetchDayLoopRows(supabase, { marketId: scope }),
    setAsideQuery,
  ]);

  const day = assembleDayLoop(dayRows, {
    focus: site.warehouseId,
    today: marketToday(scope),
    locale: marketCode === "ly" ? "ar" : "fr",
    withManagerViews: true,
  });

  const deskOrders = ((data ?? []) as unknown as WarehouseOrderRow[]).map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  // The fold names every building's set-aside parcels — the switch narrows the
  // table, not what is waiting elsewhere — and the share of a dead carrier.
  const shownSites = site.warehouseId ? day.sites.filter((s) => s.id === site.warehouseId) : day.sites;
  const fold = foldSummary(
    shownSites.map((s) => ({ id: s.id, name: s.name })),
    Object.fromEntries(day.sites.map((s) => [s.id, s.counts.setAside])),
    deadCarrierBySite((setAsideRows ?? []) as unknown as SetAsideRow[]),
  );

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
      initialTotal={day.counts.toPrepare}
      scannedToday={day.scannedToday}
      warehouseId={site.warehouseId}
      siteNames={Object.fromEntries(day.sites.map((s) => [s.id, s.name]))}
      fold={fold}
    />
  );
}
