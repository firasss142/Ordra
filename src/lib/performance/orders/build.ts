// Performance › Commandes — the whole page, computed on the server from the
// facts (prototypes/performance-commandes-v4.html, `ctx()` and each block).
// SERVER ONLY: it reads lib/calculations for the money.

import { lostShare, moneyOf, valueOf } from "@/lib/calculations/orders-performance-money";
import {
  GROUP,
  OUTCOMES,
  hasProduct,
  hasVariant,
  matchAgents,
  matchProducts,
  type Outcome,
  type PerfOrder,
  type ProductSel,
} from "./facts";
import {
  MIN_N,
  comparability,
  famOf,
  famRows,
  realDel,
  subOf,
  summarize,
  whereLeak,
  worstLeak,
  type Summary,
} from "./model";
import { daysLen, shiftDays, type PerfWindow } from "./period";
import type { PerfState } from "./query";
import type {
  AgentInfo,
  BlockRow,
  CatalogueProduct,
  DayCol,
  DrillOrder,
  DrillView,
  LeakRow,
  PerfView,
  PickerItem,
  SubLabel,
  SumM,
  WatchCard,
} from "./view";

export interface BuildInput {
  state: PerfState;
  today: string;
  first: string;
  currency: string;
  window: PerfWindow;
  /** Orders received in the window (every product, every agent). */
  A: PerfOrder[];
  /** Orders received in the previous period. */
  P: PerfOrder[];
  /** Orders received in B's dates, when comparing with other dates. */
  Bd: PerfOrder[] | null;
  /** Ad spend per market day (window and previous period). */
  ads: Record<string, number>;
  withMoney: boolean;
  catalogue: CatalogueProduct[];
  agents: AgentInfo[];
  subLabels: Record<string, SubLabel>;
}

interface Ctx {
  all: PerfOrder[];
  base: PerfOrder[];
  cur: PerfOrder[];
  prev: PerfOrder[];
  B: { list: PerfOrder[]; sel: ProductSel } | null;
}

/** The lists every block reads: A, the period before, and B. */
export function context(inp: BuildInput): Ctx {
  const { state: s } = inp;
  const all = inp.A;
  const base = all.filter((o) => matchProducts(o, s.sel));
  const cur = base.filter((o) => matchAgents(o, s.ag));
  const prev = inp.P.filter((o) => matchProducts(o, s.sel) && matchAgents(o, s.ag));
  let B: Ctx["B"] = null;
  const c = s.cmp;
  if (c?.kind === "p" && Object.keys(c.sel).length) {
    B = { list: all.filter((o) => matchProducts(o, c.sel) && matchAgents(o, s.ag)), sel: c.sel };
  } else if (c?.kind === "a" && c.ag.length) {
    B = { list: base.filter((o) => matchAgents(o, c.ag)), sel: s.sel };
  } else if (c?.kind === "d" && inp.Bd) {
    B = { list: inp.Bd.filter((o) => matchProducts(o, s.sel) && matchAgents(o, s.ag)), sel: s.sel };
  }
  return { all, base, cur, prev, B };
}

function withMoney(list: PerfOrder[], sel: ProductSel, on: boolean): SumM {
  const s: SumM = summarize(list);
  if (on) {
    const m = moneyOf(list, sel);
    s.money = { ...m, lostShare: lostShare(m) };
  }
  return s;
}

const days = (from: string, to: string) => Array.from({ length: daysLen(from, to) }, (_, i) => shiftDays(from, i));

function watchCards(inp: BuildInput, ctx: Ctx, A: Summary): WatchCard[] {
  const { today, window: w, state } = inp;
  const cards: WatchCard[] = [];

  // 1 · intake stopped (only when the window reaches today)
  if (w.to === today) {
    const pool = [...inp.P, ...inp.A].filter((o) => matchProducts(o, state.sel));
    const last = pool.filter((o) => o.day < today).reduce<string | null>((m, o) => (!m || o.day > m ? o.day : m), null);
    if (last) {
      const quiet = daysLen(last, today) - 1;
      if (quiet >= 2) {
        const since = pool.filter((o) => o.day > last).length;
        const adDays = Object.keys(inp.ads).filter((d) => inp.ads[d] > 0).sort();
        const lastAd = adDays.length ? adDays[adDays.length - 1] : null;
        // The cause is upstream when no ad ran after the last order day.
        cards.push({ kind: "intake", last, quiet, since, adsOn: !!lastAd && lastAd > last, lastAd });
      }
    }
  }

  // 2 · waiting for a decision for more than 2 days
  const stuck = ctx.cur.filter((o) => (o.bk === "c" || o.bk === "u") && daysLen(o.day, today) - 1 > 2);
  if (stuck.length) {
    cards.push({ kind: "stuck", n: stuck.length, oldest: stuck.reduce((m, o) => (o.day < m ? o.day : m), stuck[0].day) });
  }

  // 3 · rejected « Autre » without a reason
  const au = ctx.cur.filter((o) => famOf(o) === "autre");
  if (au.length >= 20 && au.length / Math.max(1, A.rejAll) >= 0.1) {
    let top: { agent: string; n: number } | null = null;
    if (state.ag.length !== 1) {
      const by = new Map<string, number>();
      for (const o of au) if (o.agent) by.set(o.agent, (by.get(o.agent) ?? 0) + 1);
      for (const [agent, n] of by) if (!top || n > top.n) top = { agent, n };
    }
    cards.push({ kind: "autre", n: au.length, per: Math.round((au.length / Math.max(1, A.n)) * 100), top });
  }

  // 4 · a city delivers worse — its home is Performance › Livraison
  const byc = new Map<string, [number, number]>();
  for (const o of ctx.cur) {
    if ((o.bk !== "d" && o.bk !== "f") || !o.city) continue;
    const v = byc.get(o.city) ?? [0, 0];
    v[o.bk === "d" ? 0 : 1] += 1;
    byc.set(o.city, v);
  }
  const cs = [...byc.entries()]
    .filter(([, v]) => v[0] + v[1] >= 40)
    .map(([city, v]) => ({ city, r: (v[0] / (v[0] + v[1])) * 100, n: v[0] + v[1] }));
  if (cs.length >= 2) {
    cs.sort((a, b) => a.r - b.r);
    const worst = cs[0];
    const rest = cs.slice(1);
    const rr = rest.reduce((s, x) => s + x.r * x.n, 0) / rest.reduce((s, x) => s + x.n, 0);
    if (rr - worst.r >= 8) cards.push({ kind: "city", city: worst.city, r: Math.round(worst.r), rest: Math.round(rr), n: worst.n });
  }

  if (!cards.length) cards.push({ kind: "ok" });
  return cards.slice(0, 3);
}

function leakRows(ctx: Ctx, A: Summary): LeakRow[] {
  if (A.n < MIN_N) return [];
  const prev = famRows(ctx.prev);
  const bRows = ctx.B && ctx.B.list.length ? famRows(ctx.B.list) : null;
  return famRows(ctx.cur)
    .slice(0, 4)
    .map((r) => ({
      key: r.key,
      n: r.n,
      per: r.per,
      prevPer: prev.find((x) => x.key === r.key)?.per ?? 0,
      bPer: bRows ? bRows.find((x) => x.key === r.key)?.per ?? 0 : null,
      subs: r.subs.slice(0, 4),
      where: whereLeak(ctx.cur, r.key),
    }));
}

function thin(list: PerfOrder[]): Summary | null {
  const s = summarize(list);
  return s.n >= 10 ? s : null;
}

function byProduct(inp: BuildInput, ctx: Ctx): PerfView["byProduct"] {
  const { state: s } = inp;
  const pool = ctx.all.filter((o) => matchAgents(o, s.ag));
  const ks = Object.keys(s.sel);
  const cat = new Map(inp.catalogue.map((p) => [p.id, p]));
  const oneId = ks.length === 1 && (cat.get(ks[0])?.sizes.length ?? 0) > 0 ? ks[0] : null;
  const bOn = !!ctx.B && ctx.B.list.length > 0;

  type R = { id: string; variant: string | null; test: (o: PerfOrder) => boolean; a: boolean; b: boolean };
  let rows: R[];
  if (oneId) {
    const sel = s.sel[oneId];
    rows = cat.get(oneId)!.sizes.map((z) => ({
      id: oneId,
      variant: z.id,
      test: (o: PerfOrder) => hasVariant(o, oneId, z.id),
      a: Array.isArray(sel) && sel.includes(z.id),
      b: false,
    }));
  } else {
    const ids = new Set<string>([...pool.flatMap((o) => o.lines.map((l) => l.p)), ...ks]);
    if (s.cmp?.kind === "p") for (const k of Object.keys(s.cmp.sel)) ids.add(k);
    rows = [...ids].filter((id) => cat.has(id)).map((id) => ({
      id,
      variant: null,
      test: (o: PerfOrder) => hasProduct(o, id),
      a: s.sel[id] !== undefined,
      b: s.cmp?.kind === "p" && s.cmp.sel[id] !== undefined,
    }));
  }

  const refList = oneId ? pool.filter((o) => hasProduct(o, oneId)) : pool;
  const ref = summarize(refList);
  const refF = famRows(refList);

  const out: BlockRow[] = rows
    .map((r) => {
      const xs = pool.filter(r.test);
      const sm = summarize(xs);
      const ok = sm.n >= MIN_N;
      let thinB: Summary | null = null;
      if (bOn && s.cmp?.kind === "d" && inp.Bd) thinB = thin(inp.Bd.filter((o) => r.test(o) && matchAgents(o, s.ag)));
      if (bOn && s.cmp?.kind === "a") {
        const ag = s.cmp.ag;
        thinB = thin(ctx.all.filter((o) => r.test(o) && matchAgents(o, ag)));
      }
      const lk = ok ? worstLeak(famRows(xs), refF) : null;
      return {
        id: r.id,
        variant: r.variant,
        s: sm,
        a: r.a,
        b: r.b,
        ok,
        delta: ok ? sm.p.del - ref.p.del : null,
        leak: lk && lk.ex >= 3 ? lk : null,
        thinB,
      };
    })
    .filter((r) => r.s.n >= 10 || ((r.a || r.b) && r.s.n > 0))
    .sort((a, b) => b.s.n - a.s.n);

  return { mode: oneId ? "sizes" : "products", productId: oneId, rows: out, refDel: ref.p.del };
}

function byAgent(inp: BuildInput, ctx: Ctx): PerfView["byAgent"] {
  const { state: s } = inp;
  const T = summarize(ctx.base);
  const tr = realDel(T);
  if (T.n < MIN_N) return { tooFew: true, teamRd: tr, rows: [] };
  const ids = [...new Set(ctx.base.map((o) => o.agent).filter((a): a is string => !!a))];
  const bOn = !!ctx.B && ctx.B.list.length > 0;
  const rows = ids.map((id) => {
    const sm = summarize(ctx.base.filter((o) => o.agent === id));
    return { id, sm, rd: realDel(sm), ok: sm.n >= MIN_N };
  });
  rows.sort((a, b) => Number(b.ok) - Number(a.ok) || (a.ok ? (b.rd ?? 0) - (a.rd ?? 0) : b.sm.n - a.sm.n));
  let rank = 0;
  return {
    tooFew: false,
    teamRd: tr,
    rows: rows.map((r) => {
      let thinB: Summary | null = null;
      if (bOn && s.cmp?.kind === "d" && inp.Bd) thinB = thin(inp.Bd.filter((o) => o.agent === r.id && matchProducts(o, s.sel)));
      if (bOn && s.cmp?.kind === "p") {
        const sel = s.cmp.sel;
        thinB = thin(ctx.all.filter((o) => o.agent === r.id && matchProducts(o, sel)));
      }
      return {
        id: r.id,
        variant: null,
        s: r.sm,
        a: s.ag.includes(r.id),
        b: s.cmp?.kind === "a" && s.cmp.ag.includes(r.id),
        ok: r.ok,
        delta: r.ok && tr != null && r.rd != null ? r.rd - tr : null,
        leak: null,
        thinB,
        rd: r.rd,
        rank: r.ok ? ++rank : null,
      };
    }),
  };
}

function daysBlock(inp: BuildInput, ctx: Ctx): PerfView["days"] {
  const { window: w } = inp;
  const by = new Map<string, DayCol>();
  for (const d of days(w.from, w.to)) {
    const g = Object.fromEntries(OUTCOMES.map((k) => [k, 0])) as Record<Outcome, number>;
    const amount = inp.ads[d] ?? 0;
    by.set(d, { day: d, n: 0, g, adOn: amount > 0, ...(inp.withMoney ? { ad: Math.round(amount) } : {}) });
  }
  for (const o of ctx.cur) {
    const c = by.get(o.day);
    if (!c) continue;
    c.n += 1;
    c.g[GROUP[o.bk]] += 1;
  }
  const cols = [...by.values()];
  // The quiet tail: two days or more, up to today, with no ads and (almost) no orders.
  let gapFrom: string | null = null;
  if (w.to === inp.today) {
    let i = cols.length - 1;
    while (i >= 0 && !cols[i].adOn && cols[i].n <= 1) i -= 1;
    if (cols.length - 1 - i >= 2) gapFrom = cols[i + 1].day;
  }
  return { cols, gapFrom };
}

function pickers(inp: BuildInput, ctx: Ctx): PerfView["pickers"] {
  const { state: s } = inp;
  const pool = ctx.all.filter((o) => matchAgents(o, s.ag));
  const wanted = new Set<string>([...ctx.all.flatMap((o) => o.lines.map((l) => l.p)), ...Object.keys(s.sel)]);
  if (s.cmp?.kind === "p") for (const k of Object.keys(s.cmp.sel)) wanted.add(k);
  const per = (sm: Summary, min: number) => (sm.n >= min ? sm.p.del : null);
  const products: PickerItem[] = inp.catalogue
    .filter((p) => wanted.has(p.id))
    .map((p) => {
      const xs = pool.filter((o) => hasProduct(o, p.id));
      const sm = summarize(xs);
      const item: PickerItem = { id: p.id, n: sm.n, delPer: per(sm, 10) };
      if (p.sizes.length) {
        item.sizes = p.sizes.map((z) => {
          const zs = summarize(xs.filter((o) => hasVariant(o, p.id, z.id)));
          return { id: z.id, n: zs.n, delPer: per(zs, 10) };
        });
      }
      return item;
    })
    .sort((a, b) => b.n - a.n);
  const agentIds = new Set<string>([...ctx.all.map((o) => o.agent).filter((a): a is string => !!a), ...s.ag]);
  if (s.cmp?.kind === "a") for (const a of s.cmp.ag) agentIds.add(a);
  const agents: PickerItem[] = inp.agents
    .filter((a) => agentIds.has(a.id))
    .map((a) => {
      const sm = summarize(ctx.base.filter((o) => o.agent === a.id));
      return { id: a.id, n: sm.n, delPer: per(sm, MIN_N) };
    })
    .sort((a, b) => b.n - a.n);
  return { products, agents };
}

export function buildView(inp: BuildInput): PerfView {
  const ctx = context(inp);
  const A = withMoney(ctx.cur, inp.state.sel, inp.withMoney);
  const P = withMoney(ctx.prev, inp.state.sel, inp.withMoney);
  const B = ctx.B ? { s: withMoney(ctx.B.list, ctx.B.sel, inp.withMoney), empty: ctx.B.list.length < 1 } : null;
  const used = new Set<string>([...inp.A, ...inp.P, ...(inp.Bd ?? [])].flatMap((o) => o.lines.map((l) => l.p)));
  const agentsUsed = new Set<string>([...inp.A, ...inp.P, ...(inp.Bd ?? [])].map((o) => o.agent).filter((a): a is string => !!a));
  for (const k of Object.keys(inp.state.sel)) used.add(k);
  for (const a of inp.state.ag) agentsUsed.add(a);
  if (inp.state.cmp?.kind === "p") for (const k of Object.keys(inp.state.cmp.sel)) used.add(k);
  if (inp.state.cmp?.kind === "a") for (const a of inp.state.cmp.ag) agentsUsed.add(a);
  return {
    today: inp.today,
    first: inp.first,
    currency: inp.currency,
    window: inp.window,
    withMoney: inp.withMoney,
    products: inp.catalogue.filter((p) => used.has(p.id)),
    agents: inp.agents.filter((a) => agentsUsed.has(a.id)),
    subLabels: inp.subLabels,
    A,
    P,
    comparable: comparability(A, P, inp.window, inp.first),
    B,
    heroAutre: ctx.cur.filter((o) => famOf(o) === "autre").length,
    watch: watchCards(inp, ctx, A),
    leaks: leakRows(ctx, A),
    byProduct: byProduct(inp, ctx),
    byAgent: byAgent(inp, ctx),
    days: daysBlock(inp, ctx),
    pickers: pickers(inp, ctx),
  };
}

// ── the drawer ──────────────────────────────────────────────────────────────

export type DrillKey = string;
export interface DrillSel {
  t: "r" | "p" | "a" | "c";
  v: string;
}

/** Which orders a drill key means (`out:del`, `fam:autre`, `bk:c`, `day:2026-09-12`, `stuck`). */
export function drillTest(key: DrillKey, today: string): ((o: PerfOrder) => boolean) | null {
  const [kind, v] = key.split(":");
  if (kind === "out" && (OUTCOMES as readonly string[]).includes(v)) return (o) => GROUP[o.bk] === v;
  if (kind === "fam") return (o) => famOf(o) === v;
  if (kind === "bk" && ["c", "u", "r"].includes(v)) return (o) => o.bk === v;
  if (kind === "day" && v) return (o) => o.day === v;
  if (kind === "stuck") return (o) => (o.bk === "c" || o.bk === "u") && daysLen(o.day, today) - 1 > 2;
  return null;
}

/** The badge / « Par motif » key of an order: its rejection sub-reason or the carrier's cause. */
export function reasonKey(o: PerfOrder): string | null {
  const f = famOf(o);
  return f ? subOf(o, f) ?? (f === "autre" ? "autre" : null) : null;
}

const countBy = (list: PerfOrder[], f: (o: PerfOrder) => (string | null)[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const o of list) for (const k of f(o)) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function buildDrill(inp: BuildInput, key: DrillKey, dsel: DrillSel | null, limit: number): DrillView | null {
  const test = drillTest(key, inp.today);
  if (!test) return null;
  const ctx = context(inp);
  const A = summarize(ctx.cur);
  const P = summarize(ctx.prev);
  const all = ctx.cur.filter(test);
  const list = dsel
    ? all.filter((o) =>
        dsel.t === "p" ? hasProduct(o, dsel.v) : dsel.t === "a" ? o.agent === dsel.v : dsel.t === "r" ? reasonKey(o) === dsel.v : o.city === dsel.v,
      )
    : all;
  const prevN = ctx.prev.filter(test).length;
  const sel = inp.state.sel;
  const firstProduct = (o: PerfOrder) => o.lines.find((l) => sel[l.p] !== undefined)?.p ?? o.lines[0]?.p ?? null;
  const orders: DrillOrder[] = [...list]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, Math.max(1, limit))
    .map((o) => ({ id: o.id, ref: o.ref, at: o.at, product: firstProduct(o), agent: o.agent, city: o.city, bk: o.bk, sub: reasonKey(o) }));
  return {
    n: all.length,
    per: (all.length / Math.max(1, A.n)) * 100,
    prevN,
    prevPer: (prevN / Math.max(1, P.n)) * 100,
    comparable: comparability(A, P, inp.window, inp.first),
    ...(inp.withMoney ? { value: Math.round(valueOf(list, sel)) } : {}),
    breakdowns: {
      r: countBy(all, (o) => [reasonKey(o)]),
      p: countBy(all, (o) => [...new Set(o.lines.map((l) => l.p))]),
      a: countBy(all, (o) => [o.agent]),
      c: countBy(all, (o) => [o.city]),
    },
    total: list.length,
    orders,
  };
}
