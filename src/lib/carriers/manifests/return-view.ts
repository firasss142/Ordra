/**
 * The « Retours » home, carrier-agnostic (plans/xdelivery-manifests.md; contract in
 * docs/xdelivery-manifests.md). Pure: the route reads, this counts.
 *
 * A line is MISSING only once its list is closed; before that it is simply not here
 * yet. Damaged parcels were received (they arrived, broken).
 */

export interface ReturnManifestRow {
  id: string;
  kind: "return" | "exchange";
  carrierId: string;
  code: string | null;
  createdAt: string | null;
  carrierStatus: string | null;
  closedAt: string | null;
  lines: Array<{ state: string; orderId: string | null }>;
}

export type ReturnManifestState = "new" | "in_progress" | "complete" | "closed_missing";

export interface ReturnManifestSummary {
  id: string;
  kind: "return" | "exchange";
  carrierId: string;
  code: string | null;
  createdAt: string | null;
  carrierStatus: string | null;
  closedAt: string | null;
  expected: number;
  received: number;
  damaged: number;
  remaining: number;
  missing: number;
  state: ReturnManifestState;
}

export interface ReturnManifestTotals {
  /** Lines still expected on lists not closed yet. */
  toReceive: number;
  /** Lines still expected on closed lists (the manager alert). */
  missing: number;
  /** Parcels refused because they were not on the open list. */
  setAside: number;
  /** Lists not closed with something left to scan. */
  openLists: number;
}

export function summarizeReturnManifests(
  rows: ReturnManifestRow[],
  setAside: number,
): { manifests: ReturnManifestSummary[]; totals: ReturnManifestTotals } {
  const manifests = rows
    .map((r): ReturnManifestSummary => {
      const lines = r.lines.filter((l) => l.state !== "removed");
      const received = lines.filter((l) => l.state === "received" || l.state === "damaged").length;
      const damaged = lines.filter((l) => l.state === "damaged").length;
      const remaining = lines.length - received;
      const missing = r.closedAt ? remaining : 0;
      const state: ReturnManifestState =
        remaining === 0 ? "complete" : r.closedAt ? "closed_missing" : received > 0 ? "in_progress" : "new";
      const { lines: _lines, ...head } = r;
      return { ...head, expected: lines.length, received, damaged, remaining, missing, state };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const open = manifests.filter((m) => !m.closedAt);
  return {
    manifests,
    totals: {
      toReceive: open.reduce((n, m) => n + m.remaining, 0),
      missing: manifests.reduce((n, m) => n + m.missing, 0),
      setAside,
      openLists: open.filter((m) => m.remaining > 0).length,
    },
  };
}
