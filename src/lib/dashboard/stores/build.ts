// Accueil — every block of the page from the facts (SERVER ONLY; the money
// goes through lib/calculations). Mirrors prototypes/dashboard-v2.html `ctx`.

import { GROUP, OUTCOMES, type Bk } from "@/lib/performance/orders/facts";
import { round100 } from "@/lib/performance/orders/model";
import { daysLen, shiftDays } from "@/lib/performance/orders/period";
import { storeDashboardMoney, paidOf, type StoreDashMoney } from "@/lib/calculations/store-dashboard-money";
import type { CohortCosts } from "@/lib/calculations/product-cohort";
import type { CohortLine } from "@/lib/products/cohort";
import { bkAt, type StoreOrder } from "./facts";
import {
  JUDGED_N,
  adsStoppedSince,
  bestStore,
  hueOf,
  noteFor,
  platformOf,
  stoppedSince,
  type Broken,
} from "./model";
import type { DashWindow } from "./period";
import type { FlowCol, NaWhy, QuietStore, StoreCard, StoreDashView, Summ } from "./view";

export interface StoreRow {
  id: string;
  name: string;
  platform: string;
  sheet_adapter: string | null;
  is_active: boolean;
  accent_color: string | null;
  last_webhook_status: string | null;
  last_webhook_error: string | null;
  webhook_failure_count: number;
  sheet_failures: number;
  sheet_failing_since: string | null;
  sheet_error: string | null;
  first_order_at: string | null;
  last_order_at: string | null;
}

export interface BuildInput {
  role: "owner" | "manager";
  currency: string;
  tz: string;
  now: Date;
  today: string;
  nowMin: number;
  first: string;
  window: DashWindow;
  /** Orders received in the window, and in the period before. */
  A: StoreOrder[];
  P: StoreOrder[];
  stores: StoreRow[];
  /** storefront id → day → orders, last 21 days. */
  daily: Map<string, Map<string, number>>;
  ads: Record<string, number>;
  productNames: Map<string, string>;
  /** Owner only. */
  money: null | {
    linesA: CohortLine[];
    linesP: CohortLine[];
    costs: Record<string, CohortCosts>;
    avgDeliveryCost: number | null;
  };
  firstDayOf: (iso: string) => string;
}

export function summ(bks: readonly Bk[]): Summ {
  const c: Record<Bk, number> = { d: 0, f: 0, b: 0, r: 0, c: 0, u: 0, x: 0, j: 0, s: 0 };
  for (const b of bks) c[b] += 1;
  const n = bks.length;
  const p = {} as Summ["p"];
  for (const k of OUTCOMES) p[k] = 0;
  for (const b of Object.keys(c) as Bk[]) p[GROUP[b]] += c[b];
  for (const k of OUTCOMES) p[k] = n ? (p[k] / n) * 100 : 0;
  const up = c.d + c.f + c.r + c.b;
  const rejAll = c.x + c.j;
  return {
    n,
    d: c.d,
    ret: c.f + c.b,
    rejAll,
    never: c.j + c.s,
    calling: c.c,
    up,
    conf: up + rejAll ? (up / (up + rejAll)) * 100 : null,
    final: n ? (1 - (c.c + c.u + c.r) / n) * 100 : 0,
    r100: round100(p),
    p,
  };
}

const DAY_MS = 86_400_000;

/** A product-cohort line as it stood at `asOf`: a result not yet reached is still on the road. */
function lineAt(l: CohortLine, asOf: number): CohortLine {
  if (l.outcome && l.outcome !== "in_flight" && l.outcome_at && Date.parse(l.outcome_at) > asOf) {
    return { ...l, outcome: "in_flight", status: "uploaded" };
  }
  return l;
}

/** Sheets stores: runs failed since the last success. Webhook stores: the last delivery errored. */
function brokenOf(s: StoreRow): Broken | null {
  if (s.sheet_failures > 0) return { since: s.sheet_failing_since, n: s.sheet_failures, msg: s.sheet_error ?? "" };
  if (s.last_webhook_status === "error" && s.webhook_failure_count > 0) {
    return { since: null, n: s.webhook_failure_count, msg: s.last_webhook_error ?? "" };
  }
  return null;
}

export function buildStoreDash(inp: BuildInput): StoreDashView {
  const { window: w, now, today } = inp;
  const nowMs = now.getTime();
  const isToday = w.key === "today";
  const asOfP = nowMs - w.lag * DAY_MS;
  // « Aujourd'hui » compares with yesterday up to the same hour.
  const P = isToday ? inp.P.filter((o) => o.min <= inp.nowMin) : inp.P;
  const A = inp.A;

  const sA = summ(A.map((o) => o.bk));
  const sP = summ(P.map((o) => bkAt(o, asOfP)));
  const beforeFirst = w.pf < inp.first;
  const okPair = (a: number, p: number) => !isToday && !beforeFirst && a >= JUDGED_N && p >= JUDGED_N;
  const comparable = okPair(sA.n, sP.n);
  const why: NaWhy | null = comparable ? null : isToday ? "today" : beforeFirst ? "before_first" : "too_few";
  const countOk = !beforeFirst && sP.n > 0;

  // ── stores ──────────────────────────────────────────────────────────────
  const byStore = (list: StoreOrder[]) => {
    const m = new Map<string, StoreOrder[]>();
    for (const o of list) {
      if (!o.store) continue;
      const arr = m.get(o.store);
      if (arr) arr.push(o);
      else m.set(o.store, [o]);
    }
    return m;
  };
  const aBy = byStore(A);
  const pBy = byStore(P);
  const mkt = Math.round(sA.p.del);
  const owner = inp.role === "owner";

  const pre = inp.stores
    .filter((s) => s.is_active || aBy.has(s.id))
    .map((s) => {
      const list = aBy.get(s.id) ?? [];
      const prevList = pBy.get(s.id) ?? [];
      const a = summ(list.map((o) => o.bk));
      const p = summ(prevList.map((o) => bkAt(o, asOfP)));
      return { s, list, a, p };
    });

  const best = bestStore(pre.filter((x) => x.a.n > 0).map((x) => ({ id: x.s.id, n: x.a.n, del: x.a.p.del, final: x.a.final })));

  const cards: StoreCard[] = [];
  const quiet: QuietStore[] = [];
  for (const { s, list, a, p } of pre) {
    const pf = platformOf(s.platform, s.sheet_adapter);
    if (!a.n) {
      if (!s.is_active) continue;
      const lastDay = s.last_order_at ? inp.firstDayOf(s.last_order_at) : null;
      const firstDay = s.first_order_at ? inp.firstDayOf(s.first_order_at) : null;
      quiet.push({ id: s.id, name: s.name, platform: pf.key, lastDay, notYet: !lastDay && !!firstDay && firstDay > w.to });
      continue;
    }
    const firstDay = s.first_order_at ? inp.firstDayOf(s.first_order_at) : null;
    const isNew = !!firstDay && firstDay >= w.from && daysLen(firstDay, w.to) - 1 < 21;
    const stop = w.live ? stoppedSince(inp.daily.get(s.id) ?? new Map(), today) : null;
    const broken = w.live ? brokenOf(s) : null;
    const lastAt = s.last_order_at;
    const mins = lastAt ? (nowMs - Date.parse(lastAt)) / 60_000 : Infinity;
    const dot: StoreCard["dot"] = !w.live || !lastAt ? null : stop || broken ? "quiet" : mins <= 120 ? "live" : "idle";
    const counts = new Map<string, number>();
    for (const o of list) for (const pid of o.products) counts.set(pid, (counts.get(pid) ?? 0) + 1);
    const products = [...counts.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([pid]) => inp.productNames.get(pid))
      .filter((x): x is string => !!x);
    let hours: number[] | undefined;
    if (isToday) {
      hours = Array.from({ length: 24 }, () => 0);
      for (const o of list) hours[Math.floor(o.min / 60)] += 1;
    }
    const card: StoreCard = {
      id: s.id,
      name: s.name,
      platform: pf.key,
      sheets: pf.sheets,
      hue: hueOf(s.accent_color),
      n: a.n,
      prevN: p.n,
      share: sA.n ? (a.n / sA.n) * 100 : 0,
      a,
      prev: p.n ? { p: p.p, conf: p.conf } : null,
      comparable: okPair(a.n, p.n),
      products,
      dot,
      lastAt: w.live ? lastAt : null,
      alarm: !!(stop || broken),
      note: noteFor({
        live: w.live,
        today: isToday,
        n: a.n,
        del: Math.round(a.p.del),
        mkt,
        unmapped: list.filter((o) => o.unmapped).length,
        broken,
        stop,
        isNew,
        isBest: best === s.id,
      }),
      firstDay,
      hours,
    };
    if (owner) card.paid = paidOf(list);
    cards.push(card);
  }
  cards.sort((x, y) => y.n - x.n);

  // ── arrival, stacked by store ───────────────────────────────────────────
  const keys = isToday ? Array.from({ length: 24 }, (_, h) => String(h)) : (() => {
    const out: string[] = [];
    for (let d = w.from; d <= w.to; d = shiftDays(d, 1)) out.push(d);
    return out;
  })();
  const idx = new Map(keys.map((k, i) => [k, i]));
  const cnt = keys.map(() => new Map<string, number>());
  for (const o of A) {
    if (!o.store) continue;
    const i = idx.get(isToday ? String(Math.floor(o.min / 60)) : o.day);
    if (i !== undefined) cnt[i].set(o.store, (cnt[i].get(o.store) ?? 0) + 1);
  }
  const nowH = Math.floor(inp.nowMin / 60);
  const flow: FlowCol[] = keys.map((k, i) => {
    const by = cards.filter((c) => cnt[i].get(c.id)).map((c) => [c.id, cnt[i].get(c.id)!] as [string, number]);
    return {
      k,
      tot: by.reduce((t, [, n]) => t + n, 0),
      by,
      fut: isToday && +k > nowH,
      now: isToday && +k === nowH,
    };
  });

  // ── money (owner) ───────────────────────────────────────────────────────
  let money: StoreDashView["money"] = null;
  if (owner && inp.money) {
    const adsIn = (f: string, t: string) => {
      let s = 0;
      for (const [d, v] of Object.entries(inp.ads)) if (d >= f && d <= t) s += v;
      return s;
    };
    const cur: StoreDashMoney = storeDashboardMoney({
      orders: A,
      lines: inp.money.linesA,
      costs: inp.money.costs,
      ads: adsIn(w.from, w.to),
      avgDeliveryCost: inp.money.avgDeliveryCost,
    });
    const pIds = new Set(P.map((o) => o.id));
    const prev = beforeFirst
      ? null
      : storeDashboardMoney({
          orders: P.map((o) => ({ ...o, bk: bkAt(o, asOfP) })),
          lines: inp.money.linesP.filter((l) => pIds.has(l.order_id)).map((l) => lineAt(l, asOfP)),
          costs: inp.money.costs,
          ads: adsIn(w.pf, w.pt),
          avgDeliveryCost: inp.money.avgDeliveryCost,
        });
    const failedFree = A.filter((o) => o.bk === "f").every((o) => o.returnCost === 0);
    money = { cur, prev, failedFree };
  }

  // ── banner: ads at zero, in a window that reaches today ─────────────────
  let ads: StoreDashView["ads"] = null;
  const since = w.live ? adsStoppedSince(inp.ads, today) : null;
  if (since) {
    ads = { since, days: daysLen(since, today), todayOrders: inp.daily.size ? [...inp.daily.values()].reduce((t, m) => t + (m.get(today) ?? 0), 0) : 0 };
  }

  let lastOrder: StoreDashView["lastOrder"] = null;
  if (!sA.n) {
    const last = inp.stores
      .filter((s) => s.last_order_at)
      .sort((x, y) => Date.parse(y.last_order_at!) - Date.parse(x.last_order_at!))[0];
    if (last?.last_order_at) lastOrder = { day: inp.firstDayOf(last.last_order_at), store: last.name };
  }

  return {
    role: inp.role,
    currency: inp.currency,
    today,
    now: now.toISOString(),
    nowMin: inp.nowMin,
    first: inp.first,
    window: w,
    asOfP: shiftDays(today, -w.lag),
    A: sA,
    P: sP,
    comparable,
    countOk,
    why,
    money,
    ads,
    flow,
    stores: cards,
    quiet,
    connected: inp.stores.filter((s) => s.is_active).length,
    lastOrder,
  };
}
