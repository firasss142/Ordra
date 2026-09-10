import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";

/**
 * Narrowing and ordering the shelf.
 *
 * The screen had a search and nothing else, so "what is under the threshold"
 * meant reading a hundred rows to find four. The states are ranked the way the
 * floor ranks them: owing more than you hold beats being low, because one is
 * already broken and the other is only about to be.
 */

export type StockState = "negative" | "low" | "ok";
export type StockSegment = "all" | "low" | "negative" | "uncounted";
export type StockSort = "name" | "stock" | "free";

export interface StockFilter {
  seg: StockSegment;
  sort: StockSort;
  q: string;
}

export const EMPTY_STOCK_FILTER: StockFilter = { seg: "all", sort: "name", q: "" };

export function stateOf(row: WarehouseStockRow): StockState {
  if (row.free < 0) return "negative";
  if (row.current_stock <= row.low_stock_threshold) return "low";
  return "ok";
}

function matchesSegment(row: WarehouseStockRow, seg: StockSegment): boolean {
  switch (seg) {
    case "low":
      return stateOf(row) === "low";
    case "negative":
      return stateOf(row) === "negative";
    case "uncounted":
      return row.last_counted_at === null;
    default:
      return true;
  }
}

export function applyStockFilters(rows: WarehouseStockRow[], filter: StockFilter): WarehouseStockRow[] {
  const q = filter.q.trim().toLowerCase();
  const out = rows.filter((row) => {
    if (!matchesSegment(row, filter.seg)) return false;
    if (!q) return true;
    // Name or code: a picker at a shelf knows one of the two, never a position
    // in an alphabetical list.
    return row.name.toLowerCase().includes(q) || (row.sku ?? "").toLowerCase().includes(q);
  });

  // The API already returns the catalogue by name, so "name" keeps that order
  // rather than re-collating it in a different locale to the server's.
  if (filter.sort === "stock") return [...out].sort((a, b) => a.current_stock - b.current_stock);
  if (filter.sort === "free") return [...out].sort((a, b) => a.free - b.free);
  return out;
}

export function stockFacets(rows: WarehouseStockRow[]): Record<StockSegment, number> {
  let low = 0;
  let negative = 0;
  let uncounted = 0;
  for (const row of rows) {
    const state = stateOf(row);
    if (state === "low") low += 1;
    if (state === "negative") negative += 1;
    if (row.last_counted_at === null) uncounted += 1;
  }
  return { all: rows.length, low, negative, uncounted };
}
