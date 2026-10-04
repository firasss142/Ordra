// The shape the API sends and the page draws (types only — safe on the client).

import type { Bk, Outcome } from "./facts";
import type { Comparability, FamKey, Summary, Where } from "./model";
import type { PerfWindow } from "./period";

export interface CatalogueProduct {
  id: string;
  name: string;
  image: string | null;
  /** Attribute variants (sizes), when the product has them. */
  sizes: { id: string; label: string }[];
}

export interface AgentInfo {
  id: string;
  name: string;
  color: string | null;
  avatar: string | null;
}

export interface SubLabel {
  fr: string;
  ar: string;
  short_fr: string | null;
  short_ar: string | null;
}

/** Computed server-side by lib/calculations/orders-performance-money.ts (never imported here). */
export interface MoneyView {
  mDel: number;
  mLost: number;
  mRoad: number;
  lostShare: number | null;
}

/** A summary; `money` only for the owner. */
export type SumM = Summary & { money?: MoneyView };

export type WatchCard =
  | { kind: "intake"; last: string; quiet: number; since: number; adsOn: boolean; lastAd: string | null }
  | { kind: "stuck"; n: number; oldest: string }
  | { kind: "autre"; n: number; per: number; top: { agent: string; n: number } | null }
  | { kind: "city"; city: string; r: number; rest: number; n: number }
  | { kind: "ok" };

export interface LeakRow {
  key: FamKey;
  n: number;
  per: number;
  prevPer: number;
  bPer: number | null;
  subs: [string, number][];
  where: Where | null;
}

export interface BlockRow {
  /** Product id (Par produit) or agent id (Par agent). */
  id: string;
  /** Size id in « Par taille ». */
  variant: string | null;
  s: Summary;
  a: boolean;
  b: boolean;
  ok: boolean;
  /** Delivered per 100 minus the reference (products) or real-delivered minus the team (agents). */
  delta: number | null;
  leak: { key: FamKey; ex: number } | null;
  thinB: Summary | null;
  /** Agents only */
  rd?: number | null;
  rank?: number | null;
}

export interface DayCol {
  day: string;
  n: number;
  g: Record<Outcome, number>;
  adOn: boolean;
  /** Owner only */
  ad?: number;
}

export interface PickerItem {
  id: string;
  n: number;
  delPer: number | null;
  sizes?: { id: string; n: number; delPer: number | null }[];
}

export interface PerfView {
  today: string;
  first: string;
  currency: string;
  window: PerfWindow;
  withMoney: boolean;
  products: CatalogueProduct[];
  agents: AgentInfo[];
  subLabels: Record<string, SubLabel>;
  A: SumM;
  P: SumM;
  comparable: Comparability;
  B: { s: SumM; empty: boolean } | null;
  heroAutre: number;
  watch: WatchCard[];
  leaks: LeakRow[];
  byProduct: { mode: "products" | "sizes"; productId: string | null; rows: BlockRow[]; refDel: number };
  byAgent: { tooFew: boolean; teamRd: number | null; rows: BlockRow[] };
  days: { cols: DayCol[]; gapFrom: string | null };
  pickers: { products: PickerItem[]; agents: PickerItem[] };
}

export interface DrillOrder {
  id: string;
  ref: string | null;
  at: string;
  product: string | null;
  agent: string | null;
  city: string | null;
  bk: Bk;
  /** The sub-reason / carrier cause key shown on the badge. */
  sub: string | null;
}

export interface DrillView {
  n: number;
  per: number;
  prevN: number;
  prevPer: number;
  comparable: Comparability;
  value?: number;
  breakdowns: { r: [string, number][]; p: [string, number][]; a: [string, number][]; c: [string, number][] };
  total: number;
  orders: DrillOrder[];
}
