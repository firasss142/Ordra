import type { ScannedRow } from "@/app/api/warehouse/scanned/route";

/**
 * Narrowing the parcels that already left the bench.
 *
 * The list shipped with no filters and two different orders — the desk floated
 * the problems, the phone did not — so a hundred rows read differently
 * depending on which device you were holding. Both surfaces call this now.
 *
 * THE SORT IS NOT CHRONOLOGICAL. Nobody opens this list to admire the last
 * scan; they open it because a sticker might not be the one Darb is holding.
 * Those rows come first whatever their age, then the newest scans.
 */

export type ScannedSegment = "all" | "check" | "waiting" | "handed";

export interface ScannedFilter {
  seg: ScannedSegment;
  /** A Darb roll hex, "unknown" for the unresolved ones, or null for any. */
  hex: string | "unknown" | null;
  product: string | null;
  /** Sticker, Darb's own number, customer or product. */
  q: string;
  /** Who scanned it. */
  who: string | null;
}

export const EMPTY_SCANNED_FILTER: ScannedFilter = {
  seg: "all",
  hex: null,
  product: null,
  q: "",
  who: null,
};

/**
 * Darb is holding a number that is not the one on our box.
 *
 * `null` is NOT a problem: it means nobody has checked yet, which is an
 * ordinary state seconds after a scan. Treating it as a fault would put every
 * fresh scan at the top of the list and bury the real ones.
 */
export function needsCheck(row: ScannedRow): boolean {
  return row.sticker_bind_state != null && row.sticker_bind_state !== "confirmed";
}

export function sortScanned(rows: ScannedRow[]): ScannedRow[] {
  return [...rows].sort((a, b) => {
    const bad = (r: ScannedRow) => (needsCheck(r) ? 0 : 1);
    if (bad(a) !== bad(b)) return bad(a) - bad(b);
    const at = (r: ScannedRow) => r.scanned_at ?? r.created_at;
    return at(b).localeCompare(at(a));
  });
}

function matchesSegment(row: ScannedRow, seg: ScannedSegment): boolean {
  switch (seg) {
    case "check":
      return needsCheck(row);
    case "waiting":
      return row.status === "scanned";
    case "handed":
      return row.status === "at_carrier";
    default:
      return true;
  }
}

export function applyScannedFilters(rows: ScannedRow[], filter: ScannedFilter): ScannedRow[] {
  const q = filter.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesSegment(row, filter.seg)) return false;
    if (filter.hex !== null) {
      const hex = row.zone?.colorHex ?? null;
      if (filter.hex === "unknown" ? hex !== null : hex !== filter.hex) return false;
    }
    if (filter.product && row.product_name !== filter.product) return false;
    if (filter.who && row.scanned_by_name !== filter.who) return false;
    if (!q) return true;
    // The sticker first: it is what the agent reads off the box. Darb's own
    // number matters just as much — that is the number a re-stickered parcel
    // is travelling under, and the only way to find it again.
    return [
      row.carrier_sticker_ref,
      row.carrier_reference_actual,
      row.tracking_number,
      row.customer_name,
      row.customer_city,
      row.product_name,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

export interface ScannedFacets {
  segments: Record<ScannedSegment, number>;
  rolls: Record<string, number>;
  unknownRoll: number;
  products: string[];
  scanners: string[];
}

/** What the unfiltered page actually holds, so no control offers an empty set. */
export function scannedFacets(rows: ScannedRow[]): ScannedFacets {
  const rolls: Record<string, number> = {};
  const products = new Set<string>();
  const scanners = new Set<string>();
  let unknownRoll = 0;
  let check = 0;
  let waiting = 0;
  let handed = 0;

  for (const row of rows) {
    const hex = row.zone?.colorHex ?? null;
    if (hex) rolls[hex] = (rolls[hex] ?? 0) + 1;
    else unknownRoll += 1;
    if (row.product_name) products.add(row.product_name);
    if (row.scanned_by_name) scanners.add(row.scanned_by_name);
    if (needsCheck(row)) check += 1;
    if (row.status === "scanned") waiting += 1;
    if (row.status === "at_carrier") handed += 1;
  }

  return {
    segments: { all: rows.length, check, waiting, handed },
    rolls,
    unknownRoll,
    products: [...products].sort((a, b) => a.localeCompare(b)),
    scanners: [...scanners].sort((a, b) => a.localeCompare(b)),
  };
}
