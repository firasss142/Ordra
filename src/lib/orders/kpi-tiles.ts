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
export type TilePatch = Pick<
  OrderListFilters,
  "preset" | "statuses" | "agentId" | "dateFrom" | "dateTo"
>;

/**
 * The period the outcome tiles count over.
 *
 * Queue tiles (`unassigned`, `toRecall`) are standing backlogs and have no
 * window — a backlog is whatever is sitting there right now.
 */
export interface KpiWindow {
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string | null;
  /** Inclusive ISO date (YYYY-MM-DD), or null for "up to now". */
  to: string | null;
}

/** Tiles that count a period rather than a standing backlog. */
export const OUTCOME_TILES = ["uploaded", "rejected", "delivered"] as const;

export function isOutcomeTile(tile: KpiTile): boolean {
  return (OUTCOME_TILES as readonly string[]).includes(tile);
}

export function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The window the outcome tiles are counted over, given the active filters.
 *
 * Whatever date range the table is filtered by is the range the tiles report,
 * so the two cannot tell different stories. With no date filter applied the
 * window falls back to today — the default the user asked for.
 */
export function resolveKpiWindow(
  filters: Pick<OrderListFilters, "dateFrom" | "dateTo">,
): KpiWindow {
  if (filters.dateFrom || filters.dateTo) {
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  return { from: todayIso(), to: null };
}

const TILE_STATUSES: Record<KpiTile, Pick<TilePatch, "preset" | "statuses" | "agentId">> = {
  unassigned: { preset: "all", statuses: [], agentId: "unassigned" },
  today: { preset: "today", statuses: [], agentId: null },
  uploaded: { preset: "all", statuses: ["uploaded"] as OrderStatus[], agentId: null },
  rejected: { preset: "all", statuses: ["rejected"] as OrderStatus[], agentId: null },
  delivered: { preset: "all", statuses: ["delivered"] as OrderStatus[], agentId: null },
  toRecall: { preset: "all", statuses: RECALL_STATUSES, agentId: null },
};

const CLEARED: TilePatch = {
  preset: "all",
  statuses: [],
  agentId: null,
  dateFrom: null,
  dateTo: null,
};

/**
 * Filters to apply when a tile is selected — `null` clears back to everything.
 *
 * An outcome tile carries its window into the table. Without that, clicking
 * "Rejetées · aujourd'hui" (16) would open an unbounded table of every
 * rejection ever recorded (1 926) — the headline number disagreeing with the
 * list it opens is the bug this whole strip exists to prevent.
 */
export function filtersForTile(tile: KpiTile | null, window?: KpiWindow): TilePatch {
  if (!tile) return { ...CLEARED };
  const f = TILE_STATUSES[tile];
  const w = isOutcomeTile(tile) ? window ?? resolveKpiWindow({ dateFrom: null, dateTo: null }) : null;
  return {
    ...f,
    statuses: [...f.statuses],
    dateFrom: w?.from ?? null,
    dateTo: w?.to ?? null,
  };
}

const sameStatuses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Which tile the current filters represent, if any.
 * Returns null when filters were hand-edited into something no tile stands for —
 * the strip then shows nothing active rather than lying about where you are.
 *
 * The date axis is part of the identity. An outcome tile is only "where you
 * are" while a window is applied, because that is the only time its count and
 * the table agree; a queue tile is only itself while no window is applied.
 */
export function tileForFilters(
  filters: Pick<OrderListFilters, "preset" | "statuses" | "agentId" | "dateFrom" | "dateTo">,
): KpiTile | null {
  const windowed = Boolean(filters.dateFrom || filters.dateTo);
  for (const [tile, f] of Object.entries(TILE_STATUSES) as [
    KpiTile,
    Pick<TilePatch, "preset" | "statuses" | "agentId">,
  ][]) {
    if (
      filters.preset === f.preset &&
      filters.agentId === f.agentId &&
      sameStatuses(filters.statuses, f.statuses) &&
      windowed === isOutcomeTile(tile)
    ) {
      return tile;
    }
  }
  return null;
}
