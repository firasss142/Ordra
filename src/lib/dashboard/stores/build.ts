// Accueil v9 — every figure of the page from the facts (SERVER ONLY; the money goes
// through lib/calculations). Mirrors prototypes/dashboard-v9.html `buildView`.

import { daysLen, shiftDays } from "@/lib/performance/orders/period";
import { caOf, paidOf } from "@/lib/calculations/store-dashboard-money";
import { bkAt, type StoreOrder } from "./facts";
import { JUDGED_N, adsStoppedSince, hueOf, noteFor, platformOf, stoppedSince, type Broken } from "./model";
import { usualAt, verdictOf, type Verdict } from "./pace";
import { isDayWindow, type DashWindow } from "./period";
import type { Kpi, RingKey, SilentStore, SparkBar, StoreCard, StoreDashView, Tiles } from "./view";

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
  /** When the store was connected. */
  created_at?: string | null;
  /** Uploaded logo (public URL), read from storefronts beside the RPC. */
  logo_url?: string | null;
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
  /** Orders received in the window. */
  A: StoreOrder[];
  /** Multi-day windows: the period before. */
  P: StoreOrder[];
  /** Day windows: the 28 days before the day (yesterday, the sparkline, the usual day). */
  H: StoreOrder[];
  stores: StoreRow[];
  /** storefront id → day → orders, last 21 days (health and the store sparklines of a day). */
  daily: Map<string, Map<string, number>>;
  ads: Record<string, number>;
  productNames: Map<string, string>;
  firstDayOf: (iso: string) => string;
}

const DAY_MS = 86_400_000;
/** Beyond this many days, one bar per day becomes slivers: Monday–Sunday weeks. */
const DAILY_MAX = 45;

/** Sheets stores: runs failed since the last success. Webhook stores: the last delivery errored. */
function brokenOf(s: StoreRow): Broken | null {
  if (s.sheet_failures > 0) return { since: s.sheet_failing_since, n: s.sheet_failures, msg: s.sheet_error ?? "" };
  if (s.last_webhook_status === "error" && s.webhook_failure_count > 0) {
    return { since: null, n: s.webhook_failure_count, msg: s.last_webhook_error ?? "" };
  }
  return null;
}

const dow = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday

/** The window's columns: days, or Monday–Sunday weeks beyond 45 days; the one in progress is `part`. */
export function columnsOf(w: Pick<DashWindow, "from" | "to" | "len">, today: string): { from: string; to: string; part: boolean }[] {
  const cols: { from: string; to: string; part: boolean }[] = [];
  if (w.len <= DAILY_MAX) {
    for (let d = w.from; d <= w.to; d = shiftDays(d, 1)) cols.push({ from: d, to: d, part: d === today });
    return cols;
  }
  for (let d = w.from; d <= w.to; ) {
    let e = shiftDays(d, 6 - dow(d));
    if (e > w.to) e = w.to;
    cols.push({ from: d, to: e, part: daysLen(d, e) < 7 || e === today });
    d = shiftDays(e, 1);
  }
  return cols;
}

interface Counts {
  n: number;
  k: Record<"d" | "f" | "b" | "r" | "c" | "u" | "x" | "j" | "s", number>;
  tried: number;
}
function count(list: readonly StoreOrder[], bk: (o: StoreOrder) => StoreOrder["bk"] = (o) => o.bk): Counts {
  const k = { d: 0, f: 0, b: 0, r: 0, c: 0, u: 0, x: 0, j: 0, s: 0 };
  let tried = 0;
  for (const o of list) {
    const b = bk(o);
    k[b] += 1;
    if (b === "c" && o.tried) tried += 1;
  }
  return { n: list.length, k, tried };
}

export function buildStoreDash(inp: BuildInput): StoreDashView {
  const { window: w, now, today } = inp;
  const owner = inp.role === "owner";
  const day = isDayWindow(w);
  const nowMs = now.getTime();
  const asOfP = nowMs - w.lag * DAY_MS;
  const A = inp.A;
  const P = day ? [] : inp.P;
  const H = day ? inp.H : [];
  const money = (v: number) => (owner ? v : 0);

  // ── the two KPIs and their sparkline ─────────────────────────────────────
  const upto = w.live ? inp.nowMin : 1440;
  let spark: SparkBar[];
  let verdict: Verdict | null = null;
  let yN: number | null = null;
  let yVal: number | null = null;
  if (day) {
    const all = [...H, ...A];
    spark = [];
    for (let k = 13; k >= 0; k--) {
      const d = shiftDays(w.from, -k);
      const list = all.filter((o) => o.day === d);
      spark.push({ from: d, to: d, n: list.length, val: money(caOf(list)), part: d === today });
    }
    verdict = verdictOf(A.length, usualAt(H, w.from, upto).now);
    if (w.live) {
      const y = H.filter((o) => o.day === shiftDays(today, -1));
      yN = y.length;
      yVal = owner ? caOf(y) : null;
    }
  } else {
    spark = columnsOf(w, today).map((c) => {
      const list = A.filter((o) => o.day >= c.from && o.day <= c.to);
      return { ...c, n: list.length, val: money(caOf(list)) };
    });
  }
  const kpi: Kpi = {
    n: A.length,
    val: owner ? caOf(A) : null,
    paid: owner ? paidOf(A) : null,
    prevN: day ? null : P.length,
    prevVal: day || !owner ? null : caOf(P),
    verdict,
    yN,
    yVal,
    spark,
  };

  // ── stores ──────────────────────────────────────────────────────────────
  const byStore = (list: readonly StoreOrder[]) => {
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
  const hBy = byStore(H);
  const delRateOf = (c: Counts) => (c.k.d + c.k.f ? (c.k.d / (c.k.d + c.k.f)) * 100 : null);
  const finalOf = (c: Counts) => (c.n ? ((c.n - c.k.c - c.k.u - c.k.r) / c.n) * 100 : 0);
  const mktDel = delRateOf(count(A));
  const adsSince = adsStoppedSince(inp.ads, today);
  const cols = day ? [] : columnsOf(w, today);

  const pre = inp.stores
    .filter((s) => s.is_active || aBy.has(s.id))
    .map((s) => {
      const list = aBy.get(s.id) ?? [];
      return { s, list, c: count(list) };
    });
  const judged = day
    ? []
    : pre.filter((x) => x.c.n >= JUDGED_N && finalOf(x.c) >= 80 && delRateOf(x.c) != null);
  const best = judged.length >= 2 ? judged.reduce((b, x) => (delRateOf(x.c)! > delRateOf(b.c)! ? x : b)).s.id : null;

  const cards: StoreCard[] = [];
  const silent: SilentStore[] = [];
  for (const { s, list, c } of pre) {
    const pf = platformOf(s.platform, s.sheet_adapter);
    const hue = hueOf(s.accent_color);
    const dailyS = inp.daily.get(s.id) ?? new Map<string, number>();
    const stop = s.is_active ? stoppedSince(dailyS, today) : null;
    const broken = s.is_active ? brokenOf(s) : null;
    const waiting = s.is_active && !s.first_order_at;
    // « à relier »: orders still waiting for a product link (in calls), in what this view read.
    const unmapped = [...list, ...(hBy.get(s.id) ?? [])].filter((o) => o.unmapped && o.bk === "c").length;
    const alarm = !!(stop || broken);
    const flagged = alarm || unmapped > 0 || waiting;
    if (!c.n && !flagged) {
      if (s.is_active) silent.push({ id: s.id, name: s.name, hue, lastAt: s.last_order_at });
      continue;
    }
    const firstDay = s.first_order_at ? inp.firstDayOf(s.first_order_at) : null;
    const isNew = !day && !!firstDay && firstDay >= w.from && daysLen(firstDay, w.to) <= 21;
    const conf = c.k.u + c.k.r + c.k.d + c.k.f + c.k.b;
    const rejAll = c.k.x + c.k.j + c.k.s;
    const delRate = delRateOf(c);
    const lastAt = s.last_order_at;
    const mins = lastAt ? (nowMs - Date.parse(lastAt)) / 60_000 : Infinity;

    let pace: Verdict | null = null;
    if (day && !alarm) {
      const v = verdictOf(c.n, usualAt(hBy.get(s.id) ?? [], w.from, upto).now);
      if (v !== "early") pace = v;
    }
    const sparkS = day
      ? Array.from({ length: 14 }, (_, i) => {
          const d = shiftDays(today, i - 13);
          return { n: dailyS.get(d) ?? 0, part: d === today };
        })
      : cols.map((col) => ({ n: list.filter((o) => o.day >= col.from && o.day <= col.to).length, part: col.part }));

    const counts = new Map<string, number>();
    for (const o of list) for (const pid of o.products) counts.set(pid, (counts.get(pid) ?? 0) + 1);
    const products = [...counts.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([pid]) => inp.productNames.get(pid))
      .filter((x): x is string => !!x);

    const tiles: Tiles = { wait: c.k.c - c.tried, tried: c.tried, up: c.k.r + c.k.d + c.k.f + c.k.b, rej: rejAll, gap: c.k.u };
    const ring: Record<RingKey, number> = {
      del: c.k.d,
      route: c.k.r + c.k.u,
      ret: c.k.f + c.k.b,
      rej: c.k.x,
      junk: c.k.j + c.k.s,
      call: c.k.c,
    };
    const prev = day ? null : count(pBy.get(s.id) ?? [], (o) => bkAt(o, asOfP));
    cards.push({
      id: s.id,
      name: s.name,
      platform: pf.key,
      sheets: pf.sheets,
      hue,
      logo: s.logo_url ?? null,
      n: c.n,
      prevN: prev ? prev.n : null,
      ca: owner ? caOf(list) : null,
      paid: owner ? paidOf(list) : null,
      tiles,
      ring,
      conf,
      confRate: conf + rejAll ? (conf / (conf + rejAll)) * 100 : null,
      delRate,
      ret: c.k.f + c.k.b,
      rejAll,
      products,
      lastAt,
      fresh: !lastAt ? "" : alarm ? "bad" : mins <= 120 ? "live" : "",
      alarm,
      flagged,
      pace,
      spark: sparkS,
      note: noteFor({
        day,
        n: c.n,
        del: delRate == null ? null : Math.round(delRate),
        mkt: mktDel == null ? null : Math.round(mktDel),
        unmapped,
        broken,
        stop,
        ads: !!stop && !!adsSince && Math.abs(daysLen(adsSince, stop.since) - 1) <= 1,
        waiting,
        isNew,
        isBest: best === s.id,
      }),
      firstDay,
      connectedAt: s.created_at ?? null,
    });
  }
  cards.sort((x, y) => y.n - x.n || Number(y.alarm) - Number(x.alarm));

  let waitingStore: StoreDashView["waiting"] = null;
  if (!inp.stores.some((s) => s.first_order_at)) {
    const s = inp.stores.find((x) => x.is_active);
    if (s) waitingStore = { name: s.name, since: s.created_at ?? null };
  }

  return {
    role: inp.role,
    currency: inp.currency,
    today,
    now: now.toISOString(),
    nowMin: inp.nowMin,
    first: inp.first,
    window: w,
    kpi,
    stores: cards,
    silent,
    waiting: waitingStore,
  };
}
