/**
 * Performance › Équipe — the rules of prototypes/team-performance-v3.html
 * (`outcomes`, `round100`, `ranking`, `leaks`, `mapPoints`, `defaultDay`), one
 * function each. Definitions: plans/team-performance-redesign.md §4–§5.
 * Pure; no React.
 */
import type { OrderFact } from "./facts";

export type OKey = "del" | "pend" | "ret" | "rej" | "junk";
/** Reading order: delivered first, unsettled last. */
export const ORDER: readonly OKey[] = ["del", "ret", "rej", "junk", "pend"];
const KEYS: readonly OKey[] = ["del", "pend", "ret", "rej", "junk"];

/** Rejections that say the order was never real (plan §4). */
export const JUNK_SUBS: readonly string[] = [
  "non_commande", "doublon", "simple_info", "numero_invalide", "numero_hors_service", "mauvais_interlocuteur",
];
/** The historic enum values that meant the same. */
const JUNK_REASONS = new Set(["faux_numero", "doublon"]);
const RETURNED = new Set(["cancelled", "returning", "to_be_returned", "returned", "received"]);
const QUEUE = new Set([
  "pending", "new", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "confirmed", "dispatch_scheduled",
]);

export interface Outcomes {
  a: number;
  del: number;
  /** Of pend: on the road. */
  road: number;
  pend: number;
  ret: number;
  rej: number;
  /** Of rej: filed as « Autre ». */
  autre: number;
  junk: number;
}

export const emptyOutcomes = (): Outcomes => ({ a: 0, del: 0, road: 0, pend: 0, ret: 0, rej: 0, autre: 0, junk: 0 });

/** The sub-reason a rejection is counted under; a bare « autre » group counts as « Autre ». */
export function subOf(o: Pick<OrderFact, "st" | "rsn" | "sub">): string | null {
  if (o.st !== "rejected") return null;
  return o.sub ?? (o.rsn === "autre" ? "autre" : null);
}

export function classify(o: OrderFact): { k: OKey; road?: true; autre?: true } {
  if (o.st === "delivered") return { k: "del" };
  if (o.st === "deleted") return { k: "junk" };
  if (o.st === "rejected") {
    const sub = subOf(o);
    if ((sub && JUNK_SUBS.includes(sub)) || (!o.sub && o.rsn && JUNK_REASONS.has(o.rsn))) return { k: "junk" };
    return sub === "autre" ? { k: "rej", autre: true } : { k: "rej" };
  }
  if (o.upl) return RETURNED.has(o.st) ? { k: "ret" } : { k: "pend", road: true };
  if (o.st === "cancelled") return { k: "junk" };
  if (QUEUE.has(o.st)) return { k: "pend" };
  return { k: "pend" };
}

export function outcomesOf(orders: readonly OrderFact[]): Outcomes {
  const t = emptyOutcomes();
  for (const o of orders) {
    const c = classify(o);
    t.a += 1;
    t[c.k] += 1;
    if (c.road) t.road += 1;
    if (c.autre) t.autre += 1;
  }
  return t;
}

export function addOutcomes(xs: readonly Outcomes[]): Outcomes {
  const t = emptyOutcomes();
  for (const o of xs) for (const k of Object.keys(t) as (keyof Outcomes)[]) t[k] += o[k];
  return t;
}

export type Per100 = Record<OKey, number>;

export function per100(o: Outcomes): Per100 {
  const r = {} as Per100;
  for (const k of KEYS) r[k] = o.a ? (o[k] / o.a) * 100 : 0;
  return r;
}

/** Largest remainder, so the five rounded numbers always add up to 100. */
export function round100(p: Per100): Per100 {
  const fl = {} as Per100;
  let left = 100;
  for (const k of KEYS) {
    fl[k] = Math.floor(p[k]);
    left -= fl[k];
  }
  if (KEYS.every((k) => p[k] === 0)) return fl;
  [...KEYS]
    .sort((x, y) => p[y] - Math.floor(p[y]) - (p[x] - Math.floor(p[x])))
    .slice(0, Math.max(0, left))
    .forEach((k) => (fl[k] += 1));
  return fl;
}

/** Ranked from this many attributed orders (v5). */
export const RANK_MIN = 30;

export interface Ranked {
  id: string;
  o: Outcomes;
  score: number;
  /** The previous window's score, when she had 30 orders then. */
  prev: number | null;
  rank: number;
}

export function rank(cur: Record<string, Outcomes>, prev: Record<string, Outcomes>): { ranked: Ranked[]; hors: { id: string; n: number }[] } {
  const ranked = Object.entries(cur)
    .filter(([, o]) => o.a >= RANK_MIN)
    .map(([id, o]) => {
      const p = prev[id];
      return { id, o, score: (o.del / o.a) * 100, prev: p && p.a >= RANK_MIN ? (p.del / p.a) * 100 : null, rank: 0 };
    })
    .sort((x, y) => y.score - x.score);
  ranked.forEach((r, i) => (r.rank = i + 1));
  const hors = Object.entries(cur)
    .filter(([, o]) => o.a < RANK_MIN)
    .map(([id, o]) => ({ id, n: o.a }));
  return { ranked, hors };
}

// ── leaks ────────────────────────────────────────────────────────────────────

export interface AgentFacts {
  o: Outcomes;
  /** Her rejected orders by sub-reason. */
  sub: Record<string, number>;
  /** Her rejected orders. */
  rejTotal: number;
  /** Of those, rejected without one attempt before. */
  noTry: number;
  /** Orders first called more than 24 h after the assignment. */
  late: number;
}

export type LeakType = "autre" | "sub" | "ret" | "first" | "late";
export type LeakUnit = "att" | "parcels" | "rej";

export interface Leak {
  type: LeakType;
  /** The sub-reason for autre/sub, else the type. */
  key: string;
  her: number;
  base: number;
  /** Her rate and the rest of the team's. */
  hr: number;
  rr: number;
  /** Orders above the others' rate. */
  ex: number;
  unit: LeakUnit;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * A leak = what she does more than the rest of the team, counted in orders.
 * Shown when the excess is ≥ max(8, 3 % of her attributed) AND her rate is
 * ≥ 1.5 × the rest's or ≥ 10 points above it. Largest excess first.
 */
export function leaks(me: AgentFacts, others: readonly AgentFacts[]): Leak[] {
  if (me.o.a < RANK_MIN) return [];
  const minEx = Math.max(8, 0.03 * me.o.a);
  const out: Leak[] = [];
  const cand = (type: LeakType, key: string, her: number, base: number, restHer: number, restBase: number, unit: LeakUnit) => {
    if (!base || !restBase) return;
    const hr = her / base, rr = restHer / restBase, ex = her - rr * base;
    if (ex >= minEx && (hr >= 1.5 * rr || hr - rr >= 0.1)) out.push({ type, key, her, base, hr, rr, ex, unit });
  };
  const restA = sum(others.map((x) => x.o.a));
  for (const [k, n] of Object.entries(me.sub)) {
    cand(k === "autre" ? "autre" : "sub", k, n, me.o.a, sum(others.map((x) => x.sub[k] ?? 0)), restA, "att");
  }
  const left = (o: Outcomes) => o.del + o.road + o.ret;
  cand("ret", "ret", me.o.ret, left(me.o), sum(others.map((x) => x.o.ret)), sum(others.map((x) => left(x.o))), "parcels");
  cand("first", "first", me.noTry, me.rejTotal, sum(others.map((x) => x.noTry)), sum(others.map((x) => x.rejTotal)), "rej");
  cand("late", "late", me.late, me.o.a, sum(others.map((x) => x.late)), restA, "att");
  return out.sort((x, y) => y.ex - x.ex);
}

// ── débit × taux ─────────────────────────────────────────────────────────────

/** Placed on the map from this many decisions (and an hour on shift). */
export const MAP_MIN_DEC = 30;

export interface MapInput {
  id: string;
  up: number;
  rej: number;
  /** Minutes on shift in the window. */
  min: number;
  pUp?: number;
  pRej?: number;
  pMin?: number;
}

export interface MapPoint {
  id: string;
  up: number;
  rej: number;
  dec: number;
  min: number;
  /** Decisions per hour on shift. */
  x: number;
  /** Upload rate, %. */
  y: number;
  px: number | null;
  py: number | null;
}

export function mapPoint(i: MapInput): MapPoint | null {
  const dec = i.up + i.rej;
  if (dec < MAP_MIN_DEC || i.min < 60) return null;
  const p: MapPoint = { id: i.id, up: i.up, rej: i.rej, dec, min: i.min, x: dec / (i.min / 60), y: (i.up / dec) * 100, px: null, py: null };
  const pd = (i.pUp ?? 0) + (i.pRej ?? 0);
  if (pd >= MAP_MIN_DEC && (i.pMin ?? 0) >= 60) {
    p.px = pd / ((i.pMin ?? 0) / 60);
    p.py = ((i.pUp ?? 0) / pd) * 100;
  }
  return p;
}

export function mapTeam(xs: readonly MapInput[]): { x: number | null; y: number | null; dec: number; min: number; u: number } {
  const u = sum(xs.map((x) => x.up)), dec = sum(xs.map((x) => x.up + x.rej)), min = sum(xs.map((x) => x.min));
  return { x: min ? dec / (min / 60) : null, y: dec ? (u / dec) * 100 : null, dec, min, u };
}

// ── présence ─────────────────────────────────────────────────────────────────

export interface Seg {
  b: number;
  e: number;
  n: number;
}

export const segMinutes = (segs: readonly Seg[] | undefined) => sum((segs ?? []).map((g) => g.e - g.b));

/**
 * The day Présence opens on: the latest day when at least half the regular
 * agents (3+ days in the window) were on shift for an hour; else the latest day
 * two did; else the latest day anyone worked; else the last day.
 */
export function defaultDay(days: readonly string[], segs: Record<string, Record<string, Seg[]>>): string {
  const agents = Object.keys(segs);
  const worked = (a: string, d: string) => (segs[a][d]?.length ?? 0) > 0;
  const regular = agents.filter((a) => days.filter((d) => worked(a, d)).length >= 3).length;
  const need = Math.max(1, Math.ceil(regular / 2) + (regular >= 4 ? 1 : 0));
  const hour = (d: string) => agents.filter((a) => segMinutes(segs[a][d]) >= 60).length;
  for (let i = days.length - 1; i >= 0; i--) if (hour(days[i]) >= need) return days[i];
  for (let i = days.length - 1; i >= 0; i--) if (hour(days[i]) >= 2) return days[i];
  for (let i = days.length - 1; i >= 0; i--) if (agents.some((a) => worked(a, days[i]))) return days[i];
  return days[days.length - 1];
}

// ── par produit ──────────────────────────────────────────────────────────────

export interface ProductRow {
  id: string;
  /** [attribuées, livrées] for the team, then per agent. */
  t: [number, number];
  ag: Record<string, [number, number]>;
}

/** Products with at least `min` orders, by volume (at most `max` rows); the rest folded into « autres ». */
export function productGrid(orders: readonly OrderFact[], cols: readonly string[], min = 10, max = 6): { rows: ProductRow[]; others: [number, number] } {
  const by = new Map<string, ProductRow>();
  for (const o of orders) {
    if (!o.p) continue;
    let r = by.get(o.p);
    if (!r) by.set(o.p, (r = { id: o.p, t: [0, 0], ag: {} }));
    const d = o.st === "delivered" ? 1 : 0;
    r.t[0] += 1;
    r.t[1] += d;
    if (cols.includes(o.a)) {
      const c = (r.ag[o.a] ??= [0, 0]);
      c[0] += 1;
      c[1] += d;
    }
  }
  const all = [...by.values()].sort((x, y) => y.t[0] - x.t[0]);
  const rows = all.filter((r) => r.t[0] >= min).slice(0, max);
  const rest = all.filter((r) => !rows.includes(r));
  return { rows, others: [rest.length, sum(rest.map((r) => r.t[0]))] };
}
