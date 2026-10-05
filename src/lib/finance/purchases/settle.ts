/**
 * Achats — the arithmetic the drawers show while the office types: the settle
 * reconciliation (prototype « Solder l'arrivage »), the due date, the sentence
 * under a payment and an order's total.
 *
 * Pure and shared: the drawer imports it to draw as you type, and the base
 * redoes every check on write — `settle_reception` recomputes the goods, the
 * gap and the fee split itself (allocate_reception_fees, mirrored by
 * src/lib/receptions/landed.ts) and refuses an unexplained gap. Nothing here is
 * the authority; it only lets the screen say what the base will say.
 */
import { allocateFees, type FeeBasis } from "@/lib/receptions/landed";

const EPS = 0.0005;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** « 1 050,5 » → 1050.5 ; empty or garbage → null (never 0: an unknown is not a zero). */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface SettleLineIn {
  /** units in good state — what entered stock */
  received: number;
  damaged: number;
  price: number | null;
}

export interface SettleMath {
  lineTotals: number[];
  goods: number;
  landed: (number | null)[];
  invoice: number | null;
  /** invoice − goods; null without an invoice */
  gap: number | null;
  damagedUnits: number;
  damagedValue: number;
  /** the gap is exactly the damaged units at their price */
  explained: boolean;
}

export function settleMath(lines: SettleLineIn[], fees: number, basis: FeeBasis, invoice: number | null): SettleMath {
  const lineTotals = lines.map((l) => round3(l.received * (l.price ?? 0)));
  const goods = round3(lineTotals.reduce((a, v) => a + v, 0));
  const alloc = allocateFees(
    lines.map((l, i) => ({ id: String(i), receivedQty: l.received, unitCost: l.price })),
    fees,
    basis,
  );
  const landed = lines.map((_, i) => alloc.allocations[i]?.landedUnitCost ?? null);
  const damagedUnits = lines.reduce((a, l) => a + l.damaged, 0);
  const damagedValue = round3(lines.reduce((a, l) => a + l.damaged * (l.price ?? 0), 0));
  const gap = invoice === null ? null : round3(invoice - goods);
  const explained = gap !== null && Math.abs(gap) >= EPS && damagedUnits > 0 && Math.abs(gap - damagedValue) < EPS;
  return { lineTotals, goods, landed, invoice, gap, damagedUnits, damagedValue, explained };
}

export type SettleChoice = "claim" | "pay";

export type SettleDecision =
  | { ok: true; invoiceTotal: number | null; claimAmount: number | null; reason: string | null; owed: number | null }
  | { ok: false; error: "reason_required" };

/**
 * What the drawer sends. A gap needs a reason (the base refuses one without);
 * when the damage explains it, `autoReason` says so in the office's words. An
 * invoice above the count is claimed by default — only the goods are owed and
 * the rest becomes an open claim — unless the office chooses to pay anyway.
 */
export function settleDecision(m: SettleMath, choice: SettleChoice, note: string, autoReason: string): SettleDecision {
  if (m.invoice === null || m.gap === null) return { ok: true, invoiceTotal: null, claimAmount: null, reason: null, owed: null };
  if (Math.abs(m.gap) < EPS) return { ok: true, invoiceTotal: m.invoice, claimAmount: null, reason: null, owed: m.invoice };
  const reason = note.trim() || (m.explained ? autoReason : "");
  if (!reason) return { ok: false, error: "reason_required" };
  if (m.gap > 0 && choice === "claim") return { ok: true, invoiceTotal: m.invoice, claimAmount: m.gap, reason, owed: m.goods };
  return { ok: true, invoiceTotal: m.invoice, claimAmount: null, reason, owed: m.invoice };
}

export type Terms = "cod" | "30" | "date";

/** On delivery = today; on credit = today + 30; otherwise the date picked. */
export function dueDateFor(today: string, terms: Terms, custom: string): string | null {
  if (terms === "cod") return today;
  if (terms === "30") return new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(custom) ? custom : null;
}

/** After a payment: what stays on this bill, what stays owed to the supplier. */
export function payOutcome(left: number, amount: number, supplierOwed: number) {
  return {
    billRest: round3(Math.max(left - amount, 0)),
    supplierRest: round3(Math.max(supplierOwed - Math.min(amount, left), 0)),
    over: amount > left + EPS,
  };
}

/** A new order's total, on the lines that carry both a quantity and a price. */
export function poTotal(lines: { qty: number | null; price: number | null }[]): number {
  return round3(lines.reduce((a, l) => a + (l.qty !== null && l.price !== null ? l.qty * l.price : 0), 0));
}
