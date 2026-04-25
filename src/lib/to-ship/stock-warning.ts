import type { ToShipRow } from "./types";

export function projectStockAfterSelection(
  rows: ToShipRow[],
  selected: Set<string>,
): Map<string, number> {
  const baseline = new Map<string, number>();
  const deducted = new Map<string, number>();

  for (const r of rows) {
    if (!r.product_id) continue;
    if (!baseline.has(r.product_id)) baseline.set(r.product_id, r.current_stock);
    if (selected.has(r.id)) {
      deducted.set(r.product_id, (deducted.get(r.product_id) ?? 0) + r.quantity);
    }
  }

  const result = new Map<string, number>();
  for (const [productId, stock] of baseline) {
    result.set(productId, stock - (deducted.get(productId) ?? 0));
  }
  return result;
}

export function flagStockWarnings(rows: ToShipRow[]): Map<string, boolean> {
  const runningStock = new Map<string, number>();
  const flags = new Map<string, boolean>();

  for (const r of rows) {
    if (!r.product_id) {
      flags.set(r.id, false);
      continue;
    }
    const current = runningStock.get(r.product_id) ?? r.current_stock;
    const after = current - r.quantity;
    flags.set(r.id, after < r.low_stock_threshold);
    runningStock.set(r.product_id, after);
  }
  return flags;
}
