/**
 * The rules the Entrepôt desk screens share (prototypes/entrepot-desk-v1.html).
 * Pure functions, so a threshold lives in one place and is tested once.
 */

/** Hours on the bench, said the way a person says it: hours under a day, days after. */
export function benchAge(hours: number): { n: number; unit: "h" | "d" } {
  const h = Math.max(0, hours);
  return h < 24 ? { n: Math.floor(h), unit: "h" } : { n: Math.floor(h / 24), unit: "d" };
}

/** A parcel waiting two days is late, four days very late. */
export function ageTone(hours: number): "" | "late" | "vlate" {
  if (hours >= 96) return "vlate";
  if (hours >= 48) return "late";
  return "";
}

/** A return sitting at Darb for over a week is late, over three weeks very late. */
export function returnTone(days: number): "" | "late" | "vlate" {
  if (days > 21) return "vlate";
  if (days > 7) return "late";
  return "";
}

/** Parcels per Darb sticker roll, busiest roll first. A parcel with no known roll is not a roll. */
export function rollCounts(rows: Array<{ zone: { colorHex: string | null } }>): Array<[string, number]> {
  const by = new Map<string, number>();
  for (const r of rows) {
    const hex = r.zone.colorHex;
    if (!hex) continue;
    by.set(hex, (by.get(hex) ?? 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}

/** Washes for a product with no picture: one per product, always the same one. */
const TINTS: Array<[string, string]> = [
  ["#F4EDE2", "#8A5A1F"],
  ["#FDE8E8", "#B42318"],
  ["#E6F2EC", "#2F6B4F"],
  ["#EEF1E4", "#566428"],
  ["#FFF0D9", "#B54708"],
  ["#E8EEFB", "#3538CD"],
  ["#F3E8FB", "#6941C6"],
];

export function thumbTint(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export type ArrivalVerdict =
  | { kind: "off" }
  | { kind: "complete" }
  | { kind: "short"; n: number }
  | { kind: "damaged"; n: number }
  | { kind: "over"; n: number };

/**
 * What a blind count says once it is compared with the purchase order.
 * Damaged units were in the box, so they count as delivered — they just never
 * enter stock. A shortfall is named first: it stays « en route » on the order.
 */
export function arrivalVerdict(input: {
  ordered: number | null;
  /** Units in good condition — what entered stock. */
  counted: number;
  damaged: number;
}): ArrivalVerdict {
  if (input.ordered === null) return { kind: "off" };
  const gap = input.counted + input.damaged - input.ordered;
  if (gap < 0) return { kind: "short", n: -gap };
  if (gap > 0) return { kind: "over", n: gap };
  if (input.damaged > 0) return { kind: "damaged", n: input.damaged };
  return { kind: "complete" };
}

const MONEY_EPSILON = 0.0005;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type Reconciliation =
  | { state: "none"; gap: 0 }
  | { state: "match"; gap: 0 }
  | { state: "damaged"; gap: number }
  | { state: "unexplained"; gap: number };

/**
 * The supplier's invoice against what the dock counted, at the prices typed.
 *
 * When the gap is exactly the damaged units at their price, the cause is
 * proposed instead of asked: the supplier billed units that never entered
 * stock. Any other gap stays unexplained and must be decided explicitly.
 */
export function reconcileInvoice(input: {
  invoice: number | null;
  goods: number;
  damagedValue: number;
  damagedUnits: number;
}): Reconciliation {
  if (input.invoice === null || !Number.isFinite(input.invoice)) return { state: "none", gap: 0 };
  const gap = round3(input.invoice - input.goods);
  if (Math.abs(gap) < MONEY_EPSILON) return { state: "match", gap: 0 };
  if (input.damagedUnits > 0 && Math.abs(gap - input.damagedValue) < MONEY_EPSILON) return { state: "damaged", gap };
  return { state: "unexplained", gap };
}

/** A purchase order is expected from its wanted day on. No date, no expectation. */
export function isDue(po: { wanted_by: string | null }, today: string): boolean {
  return po.wanted_by !== null && po.wanted_by.slice(0, 10) <= today;
}

/** Every list of the Entrepôt desk shows this many rows a page. */
export const PAGE_SIZE = 25;

export interface Paged<T> {
  rows: T[];
  /** 1-based, clamped to the pages that exist. */
  page: number;
  pages: number;
  /** 1-based position of the first and last row shown; 0 when empty. */
  from: number;
  to: number;
  total: number;
}

/**
 * One page of a list. A page past the end is clamped rather than shown empty:
 * a filter that shrinks the list must not leave the operator on « page 4 of 1 ».
 */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): Paged<T> {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: p, pages, from: total ? start + 1 : 0, to: start + slice.length, total };
}
