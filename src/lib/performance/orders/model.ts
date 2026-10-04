// Performance › Commandes — counts and rates over a list of orders
// (prototypes/performance-commandes-v4.html, `sum`, `famRows`, `where`).
// No money here: that is lib/calculations/orders-performance-money.ts.

import { failureCauseOf } from "@/lib/products/cohort";
import { GROUP, OUTCOMES, hasProduct, type Bk, type Outcome, type PerfOrder } from "./facts";
import type { PerfWindow } from "./period";

export interface Summary {
  n: number;
  d: number; f: number; b: number; r: number; c: number; u: number; x: number; j: number; s: number;
  del: number; ret: number; rej: number; junk: number; pend: number;
  up: number;
  /** Every rejected order, real or not (the confirmation denominator, as Produits). */
  rejAll: number;
  /** Uploaded ÷ (uploaded + rejected), % */
  conf: number | null;
  /** Delivered ÷ (delivered + failed), % */
  deliv: number | null;
  /** Share of orders whose result is final, % */
  final: number;
  /** Each outcome per 100 received */
  p: Record<Outcome, number>;
}

const BKS: readonly Bk[] = ["d", "f", "b", "r", "c", "u", "x", "j", "s"];

/** The fewest orders behind a « sur 100 » or a ranking. */
export const MIN_N = 30;
/** Both periods must have this share of final results before an arrow is drawn. */
export const MIN_FINAL = 90;

export function summarize(list: readonly Pick<PerfOrder, "bk">[]): Summary {
  const s = { n: list.length } as Summary;
  for (const k of BKS) s[k] = 0;
  for (const k of OUTCOMES) s[k] = 0;
  for (const o of list) {
    s[o.bk] += 1;
    s[GROUP[o.bk]] += 1;
  }
  s.up = s.d + s.f + s.r + s.b;
  s.rejAll = s.x + s.j;
  s.conf = s.up + s.rejAll ? (s.up / (s.up + s.rejAll)) * 100 : null;
  s.deliv = s.d + s.f ? (s.d / (s.d + s.f)) * 100 : null;
  s.final = s.n ? (1 - (s.c + s.u + s.r) / s.n) * 100 : 0;
  s.p = {} as Record<Outcome, number>;
  for (const k of OUTCOMES) s.p[k] = s.n ? (s[k] / s.n) * 100 : 0;
  return s;
}

/** Whole cells that add up to exactly 100 (largest remainders). */
export function round100(p: Record<Outcome, number>): Record<Outcome, number> {
  const fl = {} as Record<Outcome, number>;
  let left = 100;
  for (const k of OUTCOMES) {
    fl[k] = Math.floor(p[k]);
    left -= fl[k];
  }
  const total = OUTCOMES.reduce((a, k) => a + p[k], 0);
  if (total === 0) return fl;
  [...OUTCOMES]
    .sort((a, b) => (p[b] % 1) - (p[a] % 1))
    .slice(0, Math.max(0, left))
    .forEach((k) => (fl[k] += 1));
  return fl;
}

export type Comparability =
  | { ok: true }
  | { ok: false; why: "before_first" }
  | { ok: false; why: "not_final"; final: number }
  | { ok: false; why: "too_few" };

export function comparability(A: Summary, P: Summary, w: PerfWindow, first: string): Comparability {
  if (w.pf < first) return { ok: false, why: "before_first" };
  const fin = Math.min(A.final, P.final);
  if (fin < MIN_FINAL) return { ok: false, why: "not_final", final: Math.round(fin) };
  if (A.n < MIN_N || P.n < MIN_N) return { ok: false, why: "too_few" };
  return { ok: true };
}

/** Delivered per 100 REAL orders — « jamais réelles » are not held against an agent. */
export function realDel(s: Summary): number | null {
  const real = s.n - s.junk;
  return real ? (s.d / real) * 100 : null;
}

// ── the leaks, by cause ─────────────────────────────────────────────────────

export type FamKey = "junk" | "autre" | "refus" | "injoign" | "retour" | "avant";
export const FAM_KEYS: readonly FamKey[] = ["junk", "autre", "refus", "injoign", "retour", "avant"];
export const FAM_TONE: Record<FamKey, Outcome> = {
  junk: "junk", autre: "rej", refus: "rej", injoign: "rej", retour: "ret", avant: "ret",
};

/** Retired group keys folded into the group that absorbed them (20260827000004). */
const INJOIGNABLE = new Set(["injoignable", "faux_numero"]);

export function famOf(o: Pick<PerfOrder, "bk" | "reason">): FamKey | null {
  switch (o.bk) {
    case "j":
    case "s":
      return "junk";
    case "x":
      if (!o.reason || o.reason === "autre") return "autre";
      return INJOIGNABLE.has(o.reason) ? "injoign" : "refus";
    case "f":
      return "retour";
    case "b":
      return "avant";
    default:
      return null;
  }
}

/** The sub-reason a family is split by: the rejection sub-reason (or its group), the carrier's cause, deleted/cancelled. */
export function subOf(o: Pick<PerfOrder, "bk" | "reason" | "sub" | "cause" | "status">, fam: FamKey): string | null {
  if (fam === "autre" || fam === "avant") return null;
  if (fam === "retour") return failureCauseOf(o.cause);
  if (o.bk === "s") return o.status === "cancelled" ? "cancelled" : "deleted";
  return o.sub ?? o.reason ?? "autre";
}

export interface FamRow {
  key: FamKey;
  n: number;
  /** Per 100 received */
  per: number;
  subs: [string, number][];
}

const sortCounts = (m: Map<string, number>): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export function famRows(list: readonly PerfOrder[]): FamRow[] {
  const rows = new Map<FamKey, { n: number; subs: Map<string, number> }>();
  for (const o of list) {
    const f = famOf(o);
    if (!f) continue;
    let r = rows.get(f);
    if (!r) rows.set(f, (r = { n: 0, subs: new Map() }));
    r.n += 1;
    const s = subOf(o, f);
    if (s) r.subs.set(s, (r.subs.get(s) ?? 0) + 1);
  }
  const n = list.length;
  return FAM_KEYS.filter((k) => rows.has(k))
    .map((k) => {
      const r = rows.get(k)!;
      return { key: k, n: r.n, per: n ? (r.n / n) * 100 : 0, subs: sortCounts(r.subs) };
    })
    .sort((a, b) => b.n - a.n);
}

export type Where =
  | { kind: "product"; id: string; r: number; avg: number }
  | { kind: "agent"; id: string; r: number; avg: number }
  | { kind: "spread" };

/**
 * The product — or the agent — most over-represented in a leak: the most
 * EXCESS orders over the leak's average, among groups of at least 30 orders.
 * Never an agent for orders that were never real. Null when there is nothing
 * to split by (one product, one agent).
 */
export function whereLeak(list: readonly PerfOrder[], fam: FamKey): Where | null {
  if (!list.length) return null;
  const inFam = (o: PerfOrder) => famOf(o) === fam;
  const rate = list.filter(inFam).length / list.length;
  const products = new Set(list.flatMap((o) => o.lines.map((l) => l.p)));
  const agents = new Set(list.map((o) => o.agent).filter((a): a is string => !!a));
  const dims: { kind: "product" | "agent"; id: string; test: (o: PerfOrder) => boolean }[] = [];
  if (products.size > 1) for (const p of products) dims.push({ kind: "product", id: p, test: (o) => hasProduct(o, p) });
  if (fam !== "junk" && agents.size > 1) for (const a of agents) dims.push({ kind: "agent", id: a, test: (o) => o.agent === a });
  if (!dims.length) return null;
  let best: { kind: "product" | "agent"; id: string; ex: number; r: number } | null = null;
  for (const d of dims) {
    const all = list.filter(d.test);
    if (all.length < MIN_N) continue;
    const mine = all.filter(inFam).length;
    const ex = mine - rate * all.length;
    if (!best || ex > best.ex) best = { kind: d.kind, id: d.id, ex, r: (mine / all.length) * 100 };
  }
  if (!best || best.ex < 5) return { kind: "spread" };
  return { kind: best.kind, id: best.id, r: Math.round(best.r), avg: Math.round(rate * 100) };
}

/** The family that runs furthest above the reference on a row (« Fuite : … · +N pts »). */
export function worstLeak(rows: FamRow[], ref: FamRow[]): { key: FamKey; ex: number } | null {
  let best: { key: FamKey; ex: number } | null = null;
  for (const f of rows) {
    const avg = ref.find((x) => x.key === f.key)?.per ?? 0;
    const ex = f.per - avg;
    if (!best || ex > best.ex) best = { key: f.key, ex };
  }
  return best;
}
