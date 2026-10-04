// Accueil — the rules of the store cards (prototypes/dashboard-v2.html,
// `stopped`, `adsStopped`, `storeNote`, `ctx.best`). Pure; tested in
// __tests__/model.test.ts.

import { shiftDays } from "@/lib/performance/orders/period";

/** The five store hues, validated on every pair (plans/dashboard-redesign.md §3); the rest is slate. */
export const HUES = ["indigo", "pink", "cyan", "gold", "lime"] as const;
export type Hue = (typeof HUES)[number] | "slate";

export function hueOf(accent: string | null | undefined): Hue {
  return (HUES as readonly string[]).includes(accent ?? "") ? (accent as Hue) : "slate";
}

/** Platform = a neutral label, never a colour. A Converty store read through Sheets is Converty. */
export type PlatformKey =
  | "converty" | "shopify" | "lightfunnels" | "youcan" | "woocommerce" | "easyorders" | "buybox" | "sheets" | "other";

const PLATFORM: Record<string, PlatformKey> = {
  converty: "converty",
  shopify: "shopify",
  lightfunnels: "lightfunnels",
  youcan: "youcan",
  woocommerce: "woocommerce",
  easy_orders: "easyorders",
  easyorders: "easyorders",
  buybox: "buybox",
};

export function platformOf(platform: string, sheetAdapter: string | null): { key: PlatformKey; sheets: boolean } {
  if (platform === "google_sheets") return { key: (sheetAdapter && PLATFORM[sheetAdapter]) || "sheets", sheets: true };
  return { key: PLATFORM[platform] ?? "other", sheets: false };
}

/** A store is judged — « sur 100 », arrows, best — from this many orders. */
export const JUDGED_N = 30;

export interface Stop {
  since: string;
  usual: number;
  recent: number;
  days: number;
}

/**
 * Stopped receiving: it usually gets ≥ 5 orders a day (days −20 to −7), and every
 * day since `since` is under 25 % of that, for at least 3 days up to today.
 */
export function stoppedSince(daily: Map<string, number>, today: string): Stop | null {
  const day = (d: string) => daily.get(d) ?? 0;
  let usualSum = 0;
  for (let k = 7; k <= 20; k++) usualSum += day(shiftDays(today, -k));
  const usual = usualSum / 14;
  if (usual < 5) return null;
  let since: string | null = null;
  for (let k = 0; k <= 10; k++) {
    const d = shiftDays(today, -k);
    if (day(d) < usual * 0.25) since = d;
    else break;
  }
  if (!since) return null;
  const days = Math.round((Date.parse(today) - Date.parse(since)) / 86_400_000) + 1;
  if (days < 3) return null;
  let recent = 0;
  for (let k = 0; k < days; k++) recent += day(shiftDays(today, -k));
  return { since, usual: Math.round(usual), recent, days };
}

/** Ads at zero for ≥ 2 days in a run that reaches today, in a market that did pay for ads before. */
export function adsStoppedSince(ads: Record<string, number>, today: string): string | null {
  let since: string | null = null;
  for (let k = 0; k <= 20; k++) {
    const d = shiftDays(today, -k);
    if (!ads[d]) since = d;
    else break;
  }
  if (!since || since === today || since === shiftDays(today, -1)) return null;
  const spentBefore = Object.entries(ads).some(([d, v]) => d < since! && v > 0);
  return spentBefore ? since : null;
}

export interface Broken {
  since: string | null;
  n: number;
  msg: string;
}

export interface NoteInput {
  live: boolean;
  today: boolean;
  n: number;
  /** Delivered per 100 (whole), this store and the market. */
  del: number;
  mkt: number;
  unmapped: number;
  broken: Broken | null;
  stop: Stop | null;
  isNew: boolean;
  isBest: boolean;
}

export type Note =
  | { kind: "broken"; broken: Broken }
  | { kind: "stopped"; stop: Stop }
  | { kind: "unmapped"; n: number }
  | { kind: "todayOk" }
  | { kind: "new" }
  | { kind: "few" }
  | { kind: "best"; del: number; mkt: number }
  | { kind: "below"; del: number; mkt: number }
  | { kind: "ok"; del: number; mkt: number };

/** The card's one footer line: the first that applies. */
export function noteFor(x: NoteInput): Note {
  if (x.live && x.broken) return { kind: "broken", broken: x.broken };
  if (x.live && x.stop) return { kind: "stopped", stop: x.stop };
  if (x.unmapped > 0) return { kind: "unmapped", n: x.unmapped };
  if (x.today) return { kind: "todayOk" };
  if (x.n < JUDGED_N) return { kind: x.isNew ? "new" : "few" };
  if (x.isBest) return { kind: "best", del: x.del, mkt: x.mkt };
  if (x.del <= x.mkt - 5) return { kind: "below", del: x.del, mkt: x.mkt };
  return { kind: "ok", del: x.del, mkt: x.mkt };
}

/** The best delivery among stores judged (≥ 30 orders, ≥ 80 % final) — only when there are two to compare. */
export function bestStore(list: readonly { id: string; n: number; del: number; final: number }[]): string | null {
  const judged = list.filter((x) => x.n >= JUDGED_N && x.final >= 80);
  if (judged.length < 2) return null;
  return judged.reduce((b, x) => (x.del > b.del ? x : b)).id;
}
