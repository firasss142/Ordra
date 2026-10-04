// Performance › Commandes — the facts: one order received in the period,
// followed to today (prototypes/performance-commandes-v4.html).
//
// ── ONE DEFINITION ─────────────────────────────────────────────────────────
// What became of an order is Produits' cohort bucket (lib/products/cohort.ts
// → carrier_parcel_outcome for every uploaded parcel), split one step further
// the way the prototype draws it:
//
//   d livrée · f retournée · b annulée avant le départ · r en route
//   c en appel · u à uploader
//   x rejetée (a real order the customer refused, or nobody reached)
//   j rejetée « jamais réelle » (pas commandé, simple info, doublon, numéro faux
//     ou hors service) · s supprimée / annulée avant l'upload
//
// Unlike Produits, this page counts ORDERS: a mixed order is one order, and it
// belongs to every product it holds (its `lines`).

import { bucketOf, localDay, type ParcelOutcome, PARCEL_OUTCOMES } from "@/lib/products/cohort";

export type Bk = "d" | "f" | "b" | "r" | "c" | "u" | "x" | "j" | "s";
export type Outcome = "del" | "ret" | "rej" | "junk" | "pend";

export const OUTCOMES: readonly Outcome[] = ["del", "ret", "rej", "junk", "pend"];
export const GROUP: Record<Bk, Outcome> = {
  d: "del", f: "ret", b: "ret", x: "rej", j: "junk", s: "junk", c: "pend", u: "pend", r: "pend",
};

/** Rejection sub-reasons that mean the order was never a real one (doc: products-cohort). */
export const JUNK_SUBREASONS: ReadonlySet<string> = new Set([
  "non_commande",
  "simple_info",
  "numero_hors_service",
  "doublon",
  "numero_invalide",
]);

export function bkOf(
  status: string,
  outcome: ParcelOutcome | null,
  reason: string | null,
  sub: string | null,
): Bk {
  void reason;
  switch (bucketOf(status, outcome)) {
    case "delivered": return "d";
    case "failed": return "f";
    case "withdrawn": return "b";
    case "in_flight": return "r";
    case "calling": return "c";
    case "to_upload": return "u";
    case "rejected": return sub && JUNK_SUBREASONS.has(sub) ? "j" : "x";
    case "deleted":
    case "cancelled":
    default:
      return "s";
  }
}

export interface PerfLine {
  p: string;
  /** Attribute variants (sizes) of this product in the order. */
  v: string[];
  /** This product's part of the order value, by line price (1 for a one-product order). */
  share: number;
}

export interface PerfOrder {
  id: string;
  /** The storefront's order number, when there is one. */
  ref: string | null;
  at: string;
  /** Market-local day the order was received. */
  day: string;
  status: string;
  bk: Bk;
  /** orders.assigned_to — the agent who holds it (Salle de contrôle, Produits). */
  agent: string | null;
  reason: string | null;
  sub: string | null;
  /** The carrier's cancellation cause on a failed parcel (Darb slug). */
  cause: string | null;
  /** orders.total_price — the only revenue field. Read by lib/calculations only. */
  price: number;
  city: string | null;
  /** orders.storefront_id — the store it came from. */
  store?: string | null;
  lines: PerfLine[];
}

export type ProductSel = Record<string, string[] | null>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const OUTCOME_SET = new Set<string>(PARCEL_OUTCOMES);

export function normalizeOrders(payload: unknown, tz: string): PerfOrder[] {
  const p = (payload ?? {}) as { orders?: unknown; lines?: unknown };
  if (!Array.isArray(p.orders)) return [];
  const byOrder = new Map<string, PerfLine[]>();
  if (Array.isArray(p.lines)) {
    for (const raw of p.lines as Record<string, unknown>[]) {
      const id = str(raw.order_id);
      const pid = str(raw.product_id);
      if (!id || !pid) continue;
      const line: PerfLine = {
        p: pid,
        v: Array.isArray(raw.variants) ? (raw.variants as unknown[]).filter((x): x is string => typeof x === "string") : [],
        share: Number(raw.share ?? 1) || 0,
      };
      const arr = byOrder.get(id);
      if (arr) arr.push(line);
      else byOrder.set(id, [line]);
    }
  }
  const out: PerfOrder[] = [];
  for (const raw of p.orders as Record<string, unknown>[]) {
    const id = str(raw.id);
    const at = str(raw.created_at);
    if (!id || !at) continue;
    const status = str(raw.status) ?? "pending";
    const outcome = OUTCOME_SET.has(String(raw.outcome)) ? (raw.outcome as ParcelOutcome) : null;
    const reason = str(raw.rejection_reason);
    const sub = str(raw.rejection_subreason);
    out.push({
      id,
      ref: str(raw.ref),
      at,
      day: localDay(at, tz),
      status,
      bk: bkOf(status, outcome, reason, sub),
      agent: str(raw.assigned_to),
      reason,
      sub,
      cause: str(raw.failure_cause),
      price: Number(raw.total_price ?? 0) || 0,
      city: str(raw.city),
      store: str(raw.storefront_id),
      lines: byOrder.get(id) ?? [],
    });
  }
  return out;
}

export function matchProducts(o: Pick<PerfOrder, "lines">, sel: ProductSel): boolean {
  const keys = Object.keys(sel);
  if (!keys.length) return true;
  return o.lines.some((l) => {
    const s = sel[l.p];
    if (s === undefined) return false;
    return s === null || l.v.some((v) => s.includes(v));
  });
}

export function matchAgents(o: Pick<PerfOrder, "agent">, ag: readonly string[]): boolean {
  return !ag.length || (o.agent !== null && ag.includes(o.agent));
}

export const hasProduct = (o: Pick<PerfOrder, "lines">, pid: string) => o.lines.some((l) => l.p === pid);
export const hasVariant = (o: Pick<PerfOrder, "lines">, pid: string, vid: string) =>
  o.lines.some((l) => l.p === pid && l.v.includes(vid));
