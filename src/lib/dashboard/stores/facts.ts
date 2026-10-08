// Accueil — the facts: one order received in the period, with its store and
// the moment it reached its result (prototypes/dashboard-v2.html, `makeOrder`,
// `bkAt`). The buckets are Performance › Commandes' (lib/performance/orders/facts),
// so « livrées sur 100 » means the same on both pages.

import { bkOf, type Bk } from "@/lib/performance/orders/facts";
import { localDay, PARCEL_OUTCOMES, type ParcelOutcome } from "@/lib/products/cohort";

export interface StoreOrder {
  id: string;
  at: string;
  /** Market-local day received. */
  day: string;
  /** Market-local minute of the day received (0–1439). */
  min: number;
  store: string | null;
  /** Where it stands today. */
  bk: Bk;
  /** When it reached `bk` (ms), for a final bucket; null = unknown (counted as reached). */
  doneAt: number | null;
  /** When it was uploaded (ms), if ever. */
  upAt: number | null;
  /** orders.total_price — the only revenue field. Read by lib/calculations only. */
  price: number;
  deliveryCost: number | null;
  returnCost: number;
  unmapped: boolean;
  /** In calls and already called at least once (attempt_*, callback_scheduled) — « Tentatives ». */
  tried: boolean;
  products: string[];
}

const TRIED = new Set(["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"]);

const OUTCOMES = new Set<string>(PARCEL_OUTCOMES);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const ms = (v: unknown): number | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();
export function localMinute(iso: string, tz: string): number {
  let f = minuteFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    minuteFormatters.set(tz, f);
  }
  const [h, m] = f.format(new Date(iso)).split(":").map(Number);
  return (h % 24) * 60 + m;
}

export function normalizeStoreOrders(payload: unknown, tz: string): StoreOrder[] {
  const p = (payload ?? {}) as { orders?: unknown; lines?: unknown };
  if (!Array.isArray(p.orders)) return [];
  const lines = new Map<string, string[]>();
  if (Array.isArray(p.lines)) {
    for (const l of p.lines as Record<string, unknown>[]) {
      const id = str(l.order_id);
      const pid = str(l.product_id);
      if (!id || !pid) continue;
      const arr = lines.get(id);
      if (arr) {
        if (!arr.includes(pid)) arr.push(pid);
      } else lines.set(id, [pid]);
    }
  }
  const out: StoreOrder[] = [];
  for (const r of p.orders as Record<string, unknown>[]) {
    const id = str(r.id);
    const at = str(r.created_at);
    if (!id || !at) continue;
    const outcome = OUTCOMES.has(String(r.outcome)) ? (r.outcome as ParcelOutcome) : null;
    const status = str(r.status) ?? "pending";
    const bk = bkOf(status, outcome, str(r.rejection_reason), str(r.rejection_subreason));
    const doneAt = bk === "d" || bk === "f" ? ms(r.outcome_at) : bk === "x" || bk === "j" || bk === "s" || bk === "b" ? ms(r.decided_at) ?? ms(r.outcome_at) : null;
    const dc = r.delivery_cost;
    out.push({
      id,
      at,
      day: localDay(at, tz),
      min: localMinute(at, tz),
      store: str(r.storefront_id),
      bk,
      doneAt,
      upAt: ms(r.uploaded_at),
      price: Number(r.total_price ?? 0) || 0,
      deliveryCost: dc === null || dc === undefined || dc === "" ? null : Number(dc) || 0,
      returnCost: Number(r.return_cost ?? 0) || 0,
      unmapped: r.unmapped === true,
      tried: bk === "c" && TRIED.has(status),
      products: lines.get(id) ?? [],
    });
  }
  return out;
}

const FINAL = new Set<Bk>(["d", "f", "b", "x", "j", "s"]);

/** Where an order stood at `asOf` (ms): its result once reached; before that on the road (uploaded) or in calls. */
export function bkAt(o: Pick<StoreOrder, "bk" | "doneAt" | "upAt">, asOf: number): Bk {
  if (FINAL.has(o.bk)) {
    if (o.doneAt === null || o.doneAt <= asOf) return o.bk;
  } else if (o.bk !== "r") {
    return o.bk;
  }
  return o.upAt !== null && o.upAt <= asOf ? "r" : "c";
}
