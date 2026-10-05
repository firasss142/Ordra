/**
 * P&L global (prototypes/finances-pnl-v3.html) — the month model.
 *
 * Basis: sales DELIVERED in the calendar month (the owner's answer, see
 * plans/finances-redesign.md), so a closed month never moves. The figures come
 * from loadProfitabilitySummary; this file only cuts the calendar and names the
 * four streams the pipe draws, in the section's fixed money order.
 */
import type { ProfitabilitySummary } from "@/lib/profitability/load-summary";

export interface MonthWindow {
  /** "2026-09" */
  key: string;
  from: string;
  to: string;
  /** the month in progress — its window stops today */
  live: boolean;
}

export interface PnlMonth {
  key: string;
  live: boolean;
  /** last day counted (today for the month in progress) */
  to: string;
  /** Σ total_price of the orders delivered in the month */
  paid: number;
  cogs: number;
  /** carrier fees, delivered AND returned parcels — a return fee is a delivery cost */
  ship: number;
  ads: number;
  pack: number;
  /** bénéfice brut = paid − the four streams (before salaries and fixed costs) */
  profit: number;
  orders: number;
}

export const STREAMS = ["cogs", "ship", "ads", "pack"] as const;
export type Stream = (typeof STREAMS)[number];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The twelve closed months and the month in progress, oldest first. */
export function monthWindows(today: string, closed = 12): MonthWindow[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: MonthWindow[] = [];
  for (let back = closed; back >= 0; back--) {
    const t = y * 12 + (m - 1) - back;
    const yy = Math.floor(t / 12);
    const mm = (t % 12) + 1;
    const key = `${yy}-${pad(mm)}`;
    const live = back === 0;
    out.push({ key, from: `${key}-01`, to: live ? today : `${key}-${pad(lastDay(yy, mm))}`, live });
  }
  return out;
}

export function toPnlMonth(s: ProfitabilitySummary, w: MonthWindow): PnlMonth {
  return {
    key: w.key,
    live: w.live,
    to: w.to,
    paid: s.revenue,
    cogs: s.cogs,
    ship: Math.round((s.delivery_cost + s.return_cost) * 1000) / 1000,
    ads: s.ad_spend,
    pack: s.packing_cost,
    profit: s.net_profit,
    orders: s.delivered_count,
  };
}

/** How many of every 100 dinars paid. */
export function per100(v: number, paid: number): number {
  return paid > 0 ? Math.round((v / paid) * 100) : 0;
}

/** The month to open: the asked one, else the last closed month. */
export function pickMonth(months: { key: string; live: boolean }[], asked: string | null): number {
  const i = asked ? months.findIndex((m) => m.key === asked) : -1;
  if (i >= 0) return i;
  for (let j = months.length - 1; j >= 0; j--) if (!months[j].live) return j;
  return Math.max(0, months.length - 1);
}
