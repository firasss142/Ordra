/**
 * Rentrer's two missing facts, joined beside the returns RPC: the building the
 * parcel belongs to (`orders.warehouse_id`) and since when Darb has held it
 * (the latest `order_history` transition into the status). Oldest first,
 * because the oldest return is the one to fetch.
 */
export interface ReturnFacts {
  warehouse_id: string | null;
  /** When it reached its current status; null when no transition was recorded. */
  returned_at: string | null;
  /** Whole days since then (or since creation, when nothing was recorded). */
  days_at_carrier: number;
}

export function enrichReturns<R extends { id: string; created_at: string }>(
  rows: R[],
  meta: Array<{ id: string; warehouse_id: string | null }>,
  history: Array<{ order_id: string; created_at: string }>,
  now: Date,
  warehouseId: string | null = null,
): Array<R & ReturnFacts> {
  const site = new Map(meta.map((m) => [m.id, m.warehouse_id]));
  const since = new Map<string, string>();
  for (const h of history) {
    const prev = since.get(h.order_id);
    if (!prev || h.created_at > prev) since.set(h.order_id, h.created_at);
  }
  return rows
    .map((r) => {
      const at = since.get(r.id) ?? null;
      const from = new Date(at ?? r.created_at).getTime();
      return {
        ...r,
        warehouse_id: site.get(r.id) ?? null,
        returned_at: at,
        days_at_carrier: Math.max(0, Math.floor((now.getTime() - from) / 86_400_000)),
      };
    })
    .filter((r) => warehouseId === null || r.warehouse_id === warehouseId)
    .sort((a, b) => b.days_at_carrier - a.days_at_carrier);
}
