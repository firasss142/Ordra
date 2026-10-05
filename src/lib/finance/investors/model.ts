/**
 * Investisseurs (prototypes/finances-investisseurs-v1.html) — « comment
 * travaille leur argent ». Pure: the loader hands the deals, the engine's day
 * series (investor_deal_snapshots.series), the statements and the paid
 * withdrawals; this file cuts them into closed months per person.
 *
 * Earned counts CLOSED months only (the month in progress counts at its close),
 * from the engine's own per-day share — no second definition of the money.
 */

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "at_maturity";
export const HUES = ["indigo", "pink", "cyan", "gold", "lime"] as const;
export type Hue = (typeof HUES)[number];

export interface InvestorsInput {
  /** market-local day */
  today: string;
  investors: { id: string; name: string; method: string | null }[];
  deals: {
    id: string;
    investorId: string;
    productName: string;
    productImage: string | null;
    status: "active" | "matured" | "closed";
    start: string;
    end: string;
    sharePct: number;
    capital: number;
    cadence: Cadence;
  }[];
  /** per deal, the engine's day rows: the investor's share and the product's net that day */
  series: { dealId: string; days: { d: string; share: number; net: number }[] }[];
  statements: { dealId: string; periodEnd: string; share: number; settledAt: string }[];
  withdrawals: { investorId: string; amount: number; paidAt: string }[];
}

export interface MonthShare {
  key: string;
  share: number;
  /** the product's profit that month (100 %) */
  profit: number;
  settled: boolean;
}

export interface DealView {
  id: string;
  productName: string;
  productImage: string | null;
  sharePct: number;
  capital: number;
  start: string;
  end: string;
  status: InvestorsInput["deals"][number]["status"];
  monthIdx: number;
  monthsTotal: number;
  elapsedPct: number;
  last: MonthShare | null;
}

export interface InvestorView {
  id: string;
  name: string;
  initials: string;
  hue: Hue;
  method: string | null;
  capital: number;
  earned: number;
  paid: number;
  due: number;
  /** earned ÷ capital, in % */
  roc: number;
  cadence: Cadence;
  nextPayout: string | null;
  deals: DealView[];
  /** every closed month since the first deal started, oldest first (all deals added) */
  months: MonthShare[];
  payments: { date: string; amount: number }[];
}

export interface InvestorsView {
  lastClosed: string;
  overview: { capital: number; earned: number; paid: number; due: number; months: { key: string; share: number }[] };
  investors: InvestorView[];
  /** closed months earned but not yet in a statement */
  todo: { month: string; people: string[]; amount: number } | null;
}

const monthOf = (iso: string) => iso.slice(0, 7);
const addMonths = (key: string, n: number) => {
  const t = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const lastDayOf = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ts = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

export function nextPayout(cadence: Cadence, today: string): string | null {
  const m = Number(today.slice(5, 7));
  const span = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : cadence === "semiannual" ? 6 : cadence === "annual" ? 12 : 0;
  if (!span) return null;
  const endMonth = Math.ceil(m / span) * span;
  return lastDayOf(`${today.slice(0, 4)}-${String(endMonth).padStart(2, "0")}`);
}

function initials(name: string) {
  const parts = name.replace(/[.]/g, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

export function buildInvestorsView(input: InvestorsInput): InvestorsView {
  const lastClosed = addMonths(monthOf(input.today), -1);
  const seriesBy = new Map(input.series.map((s) => [s.dealId, s.days]));
  const settledThrough = new Map<string, string>();
  for (const s of input.statements) {
    const prev = settledThrough.get(s.dealId);
    if (!prev || s.periodEnd > prev) settledThrough.set(s.dealId, s.periodEnd);
  }

  const dealMonths = (dealId: string, start: string): MonthShare[] => {
    const by = new Map<string, { share: number; profit: number }>();
    for (const d of seriesBy.get(dealId) ?? []) {
      const k = monthOf(d.d);
      if (k > lastClosed) continue;
      const cur = by.get(k) ?? { share: 0, profit: 0 };
      cur.share += d.share;
      cur.profit += d.net;
      by.set(k, cur);
    }
    const out: MonthShare[] = [];
    const through = settledThrough.get(dealId);
    for (let k = monthOf(start); k <= lastClosed; k = addMonths(k, 1)) {
      const v = by.get(k) ?? { share: 0, profit: 0 };
      out.push({ key: k, share: r3(v.share), profit: r3(v.profit), settled: !!through && through >= lastDayOf(k) });
    }
    return out;
  };

  const todoPeople = new Set<string>();
  let todoAmount = 0;

  const investors: InvestorView[] = input.investors.map((inv, i) => {
    const deals = input.deals.filter((d) => d.investorId === inv.id);
    const monthsByDeal = new Map(deals.map((d) => [d.id, dealMonths(d.id, d.start)]));
    const merged = new Map<string, MonthShare>();
    for (const ms of monthsByDeal.values())
      for (const m of ms) {
        const cur = merged.get(m.key);
        merged.set(m.key, cur ? { key: m.key, share: r3(cur.share + m.share), profit: r3(cur.profit + m.profit), settled: cur.settled && m.settled } : { ...m });
      }
    const months = [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
    const earned = r3(Math.max(0, months.reduce((a, m) => a + m.share, 0)));
    const paid = r3(input.withdrawals.filter((w) => w.investorId === inv.id).reduce((a, w) => a + w.amount, 0));
    const capital = deals.filter((d) => d.status !== "closed").reduce((a, d) => a + d.capital, 0);

    for (const ms of monthsByDeal.values()) {
      const open = ms.filter((m) => !m.settled).reduce((a, m) => a + m.share, 0);
      if (open > 0) {
        todoPeople.add(inv.id);
        todoAmount += open;
      }
    }

    const nowTs = ts(input.today);
    const active = deals.find((d) => d.status === "active") ?? deals[0];
    return {
      id: inv.id,
      name: inv.name,
      initials: initials(inv.name),
      hue: HUES[i % HUES.length],
      method: inv.method,
      capital,
      earned,
      paid,
      due: r3(earned - paid),
      roc: capital > 0 ? (earned / capital) * 100 : 0,
      cadence: active?.cadence ?? "monthly",
      nextPayout: active ? nextPayout(active.cadence, input.today) : null,
      deals: deals.map((d) => {
        const ms = monthsByDeal.get(d.id) ?? [];
        const endExcl = addMonths(monthOf(d.end), 1);
        const totalMs = ts(`${endExcl}-01`) - ts(d.start);
        return {
          id: d.id,
          productName: d.productName,
          productImage: d.productImage,
          sharePct: d.sharePct,
          capital: d.capital,
          start: d.start,
          end: d.end,
          status: d.status,
          monthIdx: Math.max(1, monthsBetween(monthOf(d.start), monthOf(input.today)) + 1),
          monthsTotal: monthsBetween(monthOf(d.start), monthOf(d.end)) + 1,
          elapsedPct: Math.min(100, Math.max(0, ((nowTs - ts(d.start)) / totalMs) * 100)),
          last: ms.length ? ms[ms.length - 1] : null,
        };
      }),
      months,
      payments: input.withdrawals
        .filter((w) => w.investorId === inv.id)
        .map((w) => ({ date: w.paidAt.slice(0, 10), amount: w.amount }))
        .sort((a, b) => b.date.localeCompare(a.date)),
    };
  });

  const recent = Array.from({ length: 5 }, (_, i) => addMonths(lastClosed, i - 4));
  return {
    lastClosed,
    overview: {
      capital: investors.reduce((a, x) => a + x.capital, 0),
      earned: r3(investors.reduce((a, x) => a + x.earned, 0)),
      paid: r3(investors.reduce((a, x) => a + x.paid, 0)),
      due: r3(investors.reduce((a, x) => a + x.due, 0)),
      months: recent.map((key) => ({ key, share: r3(investors.reduce((a, x) => a + (x.months.find((m) => m.key === key)?.share ?? 0), 0)) })),
    },
    investors,
    todo: todoPeople.size ? { month: lastClosed, people: [...todoPeople], amount: r3(todoAmount) } : null,
  };
}
