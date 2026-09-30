/**
 * Wire types of /api/meta/mapping (GET, POST) and /api/meta/mapping/preview.
 * Types only — safe to import from client components.
 */

import type { MappingKind, SplitMode } from "./allocation";

export type { MappingKind, SplitMode };

export interface MappingVersionDTO {
  id: string;
  external_adset_id: string | null;
  /** YYYY-MM-DD; null = since the beginning. */
  effective_from: string | null;
  kind: MappingKind;
  split_mode: SplitMode | null;
  lines: { product_id: string; share_pct: number | null }[];
  created_by_name: string | null;
  created_at: string;
  superseded_at: string | null;
}

/** Spend figures a node carries, from ad_spend (what the page counts). */
export interface NodeSpend {
  spend_window: number;
  spend_life: number;
  results_window: number;
  first_day: string | null;
  last_day: string | null;
  /** [YYYY-MM-DD, amount] for each day of the window with spend. */
  daily: [string, number][];
}

export interface AdsetNodeDTO extends NodeSpend {
  id: string;
  name: string | null;
  status: string | null;
  created_time: string | null;
  /** This ad set's own versions, newest first, superseded ones included. */
  versions: MappingVersionDTO[];
  /** Its own version in force today, if any (may be "inherit"). */
  own_current_id: string | null;
}

export interface CampaignNodeDTO extends NodeSpend {
  id: string;
  ad_account_id: string;
  name: string | null;
  objective: string | null;
  status: string | null;
  created_time: string | null;
  /** Campaign-level versions, newest first, superseded ones included. */
  versions: MappingVersionDTO[];
  current_id: string | null;
  adsets: AdsetNodeDTO[];
}

export interface MappingProductDTO {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  is_active: boolean;
  orders_30d: number;
}

export interface CoverageDTO {
  total: number;
  attributed: number;
  market_level: number;
  unmapped: number;
}

export interface MappingAccountDTO {
  ad_account_id: string;
  account_name: string | null;
  currency: string;
  fx_rate: number | null;
  timezone: string;
  last_synced_at: string | null;
  /** Earliest day a remap can rewrite; null until the first ad-set backfill. */
  history_from: string | null;
}

export interface MappingTreeDTO {
  accounts: MappingAccountDTO[];
  window: { from: string; to: string };
  campaigns: CampaignNodeDTO[];
  products: MappingProductDTO[];
  coverage: { window: CoverageDTO; life: CoverageDTO; life_from: string | null };
  /** Campaigns with no decision at all (never mapped), and how much they spent. */
  unmapped: { campaigns: number; spent_campaigns: number; spend_life: number };
}

/** What the drawer sends — a preview and a save take the same body. */
export interface MappingDraftBody {
  market_id: string;
  ad_account_id: string;
  campaign_id: string;
  adset_id: string | null;
  kind: MappingKind;
  split_mode: SplitMode | null;
  lines: { product_id: string; share_pct: number | null }[];
  /** null = all history. */
  effective_from: string | null;
}

export interface MappingPreviewDTO {
  /** What will be rewritten; null when nothing recorded can move. */
  range: { since: string; until: string } | null;
  /** The requested start was earlier than the complete ad-set history. */
  clamped: boolean;
  history_from: string | null;
  days: number;
  /** Sum of the increases — equals the sum of the decreases. */
  moved: number;
  products: { product_id: string | null; before: number; after: number }[];
  /** The target's own split after the change, with the evidence behind it. */
  shares: { product_id: string; amount: number; pct: number; orders: number | null }[];
  /** Issued investor statements whose period the change rewrites. */
  statements: {
    product_id: string;
    sequence_no: number;
    period_start: string;
    period_end: string;
    settled: boolean;
    delta: number;
  }[];
}
