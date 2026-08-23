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
import { zoneForOrder, type OrderZone } from "@/lib/warehouse/zone-index";

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

  const [{ data, error }, { data: statsData }, zoneIndex, { data: dayData }] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: marketScope,
      p_limit: limit + 1,
      p_cursor_created_at: cursor?.timestamp ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
    supabase.rpc("get_warehouse_queue_stats", { p_market_id: marketScope }),
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

  const orders: ToLabelRow[] = rows.map((row) => ({
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
  };
  return NextResponse.json(body, { headers: cacheHeaders });
}
