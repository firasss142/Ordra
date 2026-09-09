import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { SCOPE_COOKIE } from "@/lib/auth/market-scope";
import { isValidScope, scopeToMarketId } from "@/lib/markets";
import {
  buildQueuePageMeta,
  clampQueueLimit,
  decodeQueueCursor,
} from "@/lib/warehouse/queue-cursor";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { attachProductImages } from "@/lib/warehouse/product-images";
import { zoneForOrder, type OrderZone } from "@/lib/warehouse/zone-index";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";

export const dynamic = "force-dynamic";

/**
 * A queue row with the sticker roll it needs.
 *
 * The colour is resolved here rather than in SQL: folding a free-text Arabic
 * city onto Darb's branch names needs hamza and alef normalisation, which lives
 * — and is tested — in darb-destination.ts. One implementation, not two.
 */
export type ToLabelRow = WarehouseOrderRow & { zone: OrderZone };

export interface ToLabelQueuePage {
  orders: ToLabelRow[];
  nextCursor: string | null;
  /**
   * The whole queue, not this page. The bench KPIs used to count the loaded
   * rows, so Préparation read "50" under an Aujourd'hui that said 407 — the
   * page size, presented as the workload.
   */
  total: number;
  late: number;
  oldestHours: number;
  /**
   * Already out for delivery at the carrier. These cannot be scanned and must
   * not read as ordinary bench work.
   */
  releasedAtCarrier: number;
  /**
   * Scans across the WHOLE market today, not this browser tab's. The KPI used
   * to count the component's own state, so it reset on reload and ignored
   * every other operator on the floor.
   */
  scannedToday: number;
  scannedYesterday: number;
  /**
   * Past the seven-day mark. `late` and this PARTITION the backlog, so showing
   * only the total makes "en retard 407" read as a duplicate of the queue size
   * when in fact 406 of them are abandoned rather than merely slow.
   */
  neverScanned: number;
  /**
   * Orders taken off the bench because they had sat there past the cutoff.
   * Every count above excludes them, so this is what keeps an emptied queue
   * from reading as a broken page — 410 orders do not evaporate.
   */
  setAside: number;
  /**
   * Live orders the CARRIER fulfils from its own warehouse. Never bench work,
   * so excluded from every figure above — and for exactly that reason it has
   * to be stated: in Libya 77 of 78 live orders are shipped this way, which
   * read on screen as an empty, broken app rather than as a normal day.
   */
  carrierWarehouse: number;
  /** The building this page is about; null when every site is shown. */
  warehouseId: string | null;
  /** True when the viewer cannot widen the site filter (an agent). */
  sitePinned: boolean;
  /**
   * A warehouse agent nobody has assigned to a building yet.
   *
   * The queue is empty on purpose, and the screen must say so: showing them
   * both buildings' parcels is how a Benghazi parcel ends up handed to Darb
   * Tripoli, where it does not exist.
   */
  siteUnassigned: boolean;
}

const cacheHeaders = {
  "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = clampQueueLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = decodeQueueCursor(req.nextUrl.searchParams.get("cursor"));

  const supabase = await createClient();

  /*
   * Super-admins pick a market in the topbar, and the packing bench must obey
   * it: this route used to pass null for them, so a super-admin with "Libye"
   * selected got Tunisian orders in the Libyan queue — cross-market work on a
   * screen whose scan flow is market-specific.
   * An explicit ?market_id wins; otherwise the scope cookie decides.
   */
  const requested = req.nextUrl.searchParams.get("market_id");
  const cookieScope = req.cookies.get(SCOPE_COOKIE)?.value;
  const marketScope =
    actor.role !== "super_admin"
      ? (actor.market_id ?? null)
      : requested && requested !== "all"
        ? requested
        : isValidScope(cookieScope)
          ? scopeToMarketId(cookieScope)
          : null;

  /*
   * Which building. An agent is pinned to their own — Libya's two warehouses
   * are not interchangeable, and a Benghazi agent shown Tripoli's 365 parcels
   * is being offered work they cannot do. A manager sees both unless they say
   * otherwise. The RPCs re-check it; this only decides what is displayed.
   */
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: req.nextUrl.searchParams.get("warehouse_id"),
  });

  /*
   * No building, no work. Returning the market-wide queue here would mix
   * Tripoli and Benghazi on one bench, and the SQL guard cannot catch the
   * mis-scan that follows because it needs a site on BOTH sides to fire.
   * The empty page carries its own explanation instead.
   */
  if (site.unassigned) {
    const empty: ToLabelQueuePage = {
      orders: [],
      nextCursor: null,
      total: 0,
      late: 0,
      oldestHours: 0,
      releasedAtCarrier: 0,
      scannedToday: 0,
      scannedYesterday: 0,
      neverScanned: 0,
      setAside: 0,
      carrierWarehouse: 0,
      warehouseId: null,
      sitePinned: true,
      siteUnassigned: true,
    };
    return NextResponse.json(empty, { headers: cacheHeaders });
  }

  const [{ data, error }, { data: statsData }, zoneIndex, { data: dayData }] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: marketScope,
      p_limit: limit + 1,
      p_cursor_created_at: cursor?.timestamp ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_warehouse_id: site.warehouseId,
    }),
    supabase.rpc("get_warehouse_queue_stats", {
      p_market_id: marketScope,
      p_warehouse_id: site.warehouseId,
    }),
    getZoneIndex(supabase),
    supabase.rpc("get_warehouse_day_stats", { p_market_id: marketScope }),
  ]);

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const stats = (statsData ?? {}) as Record<string, number | null>;
  const day = (dayData ?? {}) as Record<string, number | null>;

  const { rows, nextCursor } = buildQueuePageMeta(
    (data ?? []) as WarehouseOrderRow[],
    limit,
  );

  const pictured = await attachProductImages(supabase, rows);
  const orders: ToLabelRow[] = pictured.map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  const body: ToLabelQueuePage = {
    orders,
    nextCursor,
    total: Number(stats.to_prepare ?? orders.length),
    // Anything past two days on the bench, however long it has been there.
    late: Number(stats.late_prepare ?? 0) + Number(stats.never_scanned ?? 0),
    oldestHours: Number(stats.oldest_prepare_hours ?? 0),
    releasedAtCarrier: Number(stats.released_at_carrier ?? 0),
    scannedToday: Number(day.scanned_today ?? 0),
    scannedYesterday: Number(day.scanned_yesterday ?? 0),
    neverScanned: Number(stats.never_scanned ?? 0),
    setAside: Number(stats.set_aside ?? 0),
    carrierWarehouse: Number(stats.carrier_warehouse ?? 0),
    warehouseId: site.warehouseId,
    sitePinned: site.pinned,
    siteUnassigned: false,
  };
  return NextResponse.json(body, { headers: cacheHeaders });
}
