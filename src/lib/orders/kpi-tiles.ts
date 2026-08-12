import type { OrderStatus } from "@/types/order-status";
import type { OrderListFilters } from "./list-filters";
import type { KpiTile } from "@/components/orders/OrdersKpiStrip";

/**
 * Tile → filter mapping for the orders KPI strip.
 *
 * Each tile's filter must select exactly the set its count came from
 * (see /api/orders/status-counts). If these two drift apart you get the
 * original bug back: a headline number that disagrees with the table it opens.
 */

export const RECALL_STATUSES: OrderStatus[] = [
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
] as OrderStatus[];


/** The slice of OrderListFilters a tile controls — everything else is left alone. */
export type TilePatch = Pick<OrderListFilters, "preset" | "statuses" | "agentId">;

const TILE_FILTERS: Record<KpiTile, TilePatch> = {
  unassigned: { preset: "all", statuses: [], agentId: "unassigned" },
  today: { preset: "today", statuses: [], agentId: null },
  waiting: { preset: "all", statuses: ["pending"] as OrderStatus[], agentId: null },
  toRecall: { preset: "all", statuses: RECALL_STATUSES, agentId: null },
  uploaded: { preset: "all", statuses: ["uploaded"] as OrderStatus[], agentId: null },
  rejected: { preset: "all", statuses: ["rejected"] as OrderStatus[], agentId: null },
};

const CLEARED: TilePatch = { preset: "all", statuses: [], agentId: null };

/** Filters to apply when a tile is selected — `null` clears back to everything. */
export function filtersForTile(tile: KpiTile | null): TilePatch {
  if (!tile) return { ...CLEARED };
  const f = TILE_FILTERS[tile];
  return { ...f, statuses: [...f.statuses] };
}

const sameStatuses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Which tile the current filters represent, if any.
 * Returns null when filters were hand-edited into something no tile stands for —
 * the strip then shows nothing active rather than lying about where you are.
 */
export function tileForFilters(filters: Pick<OrderListFilters, "preset" | "statuses" | "agentId">): KpiTile | null {
  for (const [tile, f] of Object.entries(TILE_FILTERS) as [KpiTile, TilePatch][]) {
    if (
      filters.preset === f.preset &&
      filters.agentId === f.agentId &&
      sameStatuses(filters.statuses, f.statuses)
    ) {
      return tile;
    }
  }
  return null;
}
