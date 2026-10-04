// What GET /api/dashboard/stores returns — every figure of Accueil, already
// computed (prototypes/dashboard-v2.html). The page only formats and draws.

import type { Outcome } from "@/lib/performance/orders/facts";
import type { StoreDashMoney } from "@/lib/calculations/store-dashboard-money";
import type { DashWindow } from "./period";
import type { Hue, Note, PlatformKey } from "./model";

export interface Summ {
  n: number;
  /** Delivered parcels. */
  d: number;
  /** Came back (returned + cancelled before leaving). */
  ret: number;
  /** Rejected, real or not. */
  rejAll: number;
  /** Of which never real. */
  never: number;
  /** Still in calls (not decided). */
  calling: number;
  /** Uploaded (left, or on the road). */
  up: number;
  /** Uploaded ÷ (uploaded + rejected), % */
  conf: number | null;
  /** Share with a final result, % */
  final: number;
  /** Each outcome per 100, whole cells adding up to 100. */
  r100: Record<Outcome, number>;
  /** Raw per-100 values (the arrows compare whole numbers of these). */
  p: Record<Outcome, number>;
}

export type NaWhy = "before_first" | "too_few" | "today";

export interface StoreCard {
  id: string;
  name: string;
  platform: PlatformKey;
  sheets: boolean;
  hue: Hue;
  n: number;
  prevN: number;
  /** Share of the market's orders, % */
  share: number;
  a: Summ;
  prev: Pick<Summ, "p" | "conf"> | null;
  /** « sur 100 » arrows allowed (both periods ≥ 30, not today). */
  comparable: boolean;
  /** Owner only. */
  paid?: number;
  /** Product names, most ordered first. */
  products: string[];
  dot: "live" | "quiet" | "idle" | null;
  lastAt: string | null;
  /** The freshness chip turns amber. */
  alarm: boolean;
  note: Note;
  firstDay: string | null;
  /** Today only: orders per market-local hour. */
  hours?: number[];
}

export interface QuietStore {
  id: string;
  name: string;
  platform: PlatformKey;
  lastDay: string | null;
  /** First order after the window: not open yet. */
  notYet: boolean;
}

export interface FlowCol {
  /** Day (YYYY-MM-DD) or hour ("0".."23"). */
  k: string;
  tot: number;
  /** [store id, orders] in the order of the store list. */
  by: [string, number][];
  fut: boolean;
  now: boolean;
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
  /** The day the period before is read as of (equal age). */
  asOfP: string;
  A: Summ;
  P: Summ;
  /** Rate arrows allowed. */
  comparable: boolean;
  /** Count arrows allowed (a period before exists and is not empty). */
  countOk: boolean;
  why: NaWhy | null;
  money: { cur: StoreDashMoney; prev: StoreDashMoney | null; failedFree: boolean } | null;
  ads: { since: string; days: number; todayOrders: number } | null;
  flow: FlowCol[];
  stores: StoreCard[];
  quiet: QuietStore[];
  connected: number;
  lastOrder: { day: string; store: string | null } | null;
}
