// What GET /api/dashboard/stores returns — every figure of Accueil v9, already
// computed (prototypes/dashboard-v9.html, `buildView`). The page only formats and draws.

import type { DashWindow } from "./period";
import type { Hue, Note, PlatformKey } from "./model";
import type { Verdict } from "./pace";

/** One bar of a sparkline: a day, or a Monday–Sunday week beyond 45 days. */
export interface SparkBar {
  from: string;
  to: string;
  n: number;
  /** Σ orders.total_price of those orders — owner only (0 for a manager). */
  val: number;
  /** The day (or week) in progress, or a week cut short: drawn hatched, never read as a drop. */
  part: boolean;
}

export interface Kpi {
  /** Orders received in the window. */
  n: number;
  /** Chiffre d'affaires: Σ orders.total_price of those orders. Owner only, else null. */
  val: number | null;
  /** Of which delivered (encaissé). Owner only, else null. */
  paid: number | null;
  /** The period before (multi-day windows only). */
  prevN: number | null;
  prevVal: number | null;
  /** Pace against a usual day (day windows only). */
  verdict: Verdict | null;
  /** « Hier » beside « Aujourd'hui ». */
  yN: number | null;
  yVal: number | null;
  /** The 14 days up to the day shown, or the window's own columns. */
  spark: SparkBar[];
}

/** The four tiles of a day, in the order an order lives them; `gap` = confirmed, not yet uploaded. */
export interface Tiles {
  wait: number;
  tried: number;
  up: number;
  rej: number;
  gap: number;
}

export type RingKey = "del" | "route" | "ret" | "rej" | "junk" | "call";
export const RING_KEYS: readonly RingKey[] = ["del", "route", "ret", "rej", "junk", "call"];

export interface StoreCard {
  id: string;
  name: string;
  platform: PlatformKey;
  sheets: boolean;
  hue: Hue;
  logo: string | null;
  n: number;
  /** The period before (multi-day windows), null otherwise. */
  prevN: number | null;
  /** Owner only. */
  ca: number | null;
  paid: number | null;
  tiles: Tiles;
  ring: Record<RingKey, number>;
  /** Confirmed (incl. awaiting upload) and its rate over the decided, %. */
  conf: number;
  confRate: number | null;
  /** Delivered ÷ (delivered + failed), %. */
  delRate: number | null;
  ret: number;
  rejAll: number;
  products: string[];
  lastAt: string | null;
  fresh: "live" | "bad" | "";
  /** Broken or stopped: the card's edge and count turn red. */
  alarm: boolean;
  /** Something to look at (broken, stopped, orders to link, waiting): shown even with 0 orders. */
  flagged: boolean;
  pace: Verdict | null;
  spark: { n: number; part: boolean }[];
  note: Note;
  firstDay: string | null;
  /** When the store was connected (the « waiting » note says it). */
  connectedAt: string | null;
}

export interface SilentStore {
  id: string;
  name: string;
  hue: Hue;
  lastAt: string | null;
}

export interface StoreDashView {
  role: "owner" | "manager";
  currency: string;
  today: string;
  /** Server time (ISO) the view was built at — the « il y a 23 min » reference. */
  now: string;
  /** Market-local minute of the day, now. */
  nowMin: number;
  first: string;
  window: DashWindow;
  kpi: Kpi;
  /** Stores with orders in the window, or with something to look at — most orders first. */
  stores: StoreCard[];
  silent: SilentStore[];
  /** No order ever: the store waiting for its first one (the empty page names it). */
  waiting: { name: string; since: string | null } | null;
}
