/**
 * Which product's P&L — and which investor's share — absorbs a dinar of Meta
 * spend. Pure: no DB, no clock, no network. The sync and the mapping routes load
 * the inputs; this module decides.
 *
 * ── The model (plans/ad-spend-adset-mapping.md) ────────────────────────────
 * A FACT is one Meta ad set on one day (`meta_adset_daily`). It names no product.
 * A MAPPING VERSION says what a campaign — or one of its ad sets — sells, from a
 * date (or since the beginning), until the next version of the same target.
 * `ad_spend`'s meta rows are the projection of facts × the version in force on
 * each fact's own day, and are rewritten whole whenever either side changes.
 *
 * ── Why the split is by that day's orders ──────────────────────────────────
 * No order carries ad attribution (all 7 137 were checked: no utm, no fbclid).
 * When one campaign sells three sizes, the only evidence of what it sold is which
 * sizes were ordered while it ran. On "BoxLyLong - relaunch" that moves 16 696
 * LYD from the large doll alone to 63 / 20 / 17 % medium / small / large.
 * A day on which none of the products took an order borrows the mix of the 7
 * days before it; only eight silent days in a row fall back to equal parts.
 * `allocation_basis` records which rule applied, row by row.
 *
 * ── Money ──────────────────────────────────────────────────────────────────
 * Dinars are NUMERIC(10,3), so amounts are split in integer millimes with
 * largest remainder: the parts of an ad set-day always add back to it exactly.
 * The original-currency amount (4dp) and the counters are split the same way.
 * Reach and frequency are people, not events: a split row carries neither.
 */

import { toMillimes, fromMillimes } from "@/lib/calculations/math";

export type MappingKind = "products" | "market_level" | "inherit";
export type SplitMode = "auto_orders" | "manual";
export type AllocationBasis =
  | "single"
  | "auto_orders"
  | "auto_trailing_7d"
  | "auto_equal"
  | "manual"
  | "market_level"
  | "unmapped";

export interface MappingLine {
  product_id: string;
  /** Manual split only; the lines of one version sum to 100. */
  share_pct: number | null;
}

/** A LIVE version (not superseded). */
export interface MappingVersion {
  id: string;
  external_campaign_id: string;
  /** null = campaign level, which every ad set follows unless it has its own. */
  external_adset_id: string | null;
  /** YYYY-MM-DD; null = since the beginning. */
  effective_from: string | null;
  kind: MappingKind;
  split_mode: SplitMode | null;
  lines: MappingLine[];
}

/** day (YYYY-MM-DD, ad account timezone) → product_id → orders created. */
export type OrderCounts = Map<string, Map<string, number>>;

/** One ad set on one day, as stored in meta_adset_daily. */
export interface AdsetDayFact {
  ad_account_id: string;
  market_id: string;
  external_campaign_id: string;
  external_adset_id: string;
  campaign_name: string | null;
  adset_name: string | null;
  day: string;
  /** Market currency, dinars. */
  amount: number;
  spend_original: number;
  currency_original: string;
  fx_rate: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  frequency: number | null;
  platform_results: number | null;
  synced_at?: string | null;
}

/** One `ad_spend` meta row, in the shape replace_meta_ad_spend takes. */
export interface AdSpendProjectionRow {
  market_id: string;
  ad_account_id: string;
  product_id: string | null;
  amount: number;
  period_start: string;
  external_campaign_id: string;
  external_adset_id: string;
  campaign_name: string | null;
  adset_name: string | null;
  amount_original: number;
  currency_original: string;
  fx_rate: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  frequency: number | null;
  platform_results: number | null;
  synced_at: string | null;
  /** The fraction of its ad set-day this row carries: 1 when unsplit. */
  allocation_share: number;
  allocation_basis: AllocationBasis;
  mapping_id: string | null;
}

/* ─────────────────────────── resolution ─────────────────────────── */

/**
 * The version of exactly this target in force on `day`: the latest start on or
 * before it, a null start counting as the earliest of all.
 */
export function versionInForce(
  versions: MappingVersion[],
  campaignId: string,
  adsetId: string | null,
  day: string,
): MappingVersion | null {
  let best: MappingVersion | null = null;
  for (const version of versions) {
    if (version.external_campaign_id !== campaignId) continue;
    if (version.external_adset_id !== adsetId) continue;
    if (version.effective_from !== null && version.effective_from > day) continue;
    if (
      best === null ||
      (version.effective_from ?? "") > (best.effective_from ?? "")
    ) {
      best = version;
    }
  }
  return best;
}

/**
 * What an ad set sells on `day`: its own version if it has one in force and
 * that version is not "inherit", otherwise its campaign's.
 */
export function resolveMapping(
  versions: MappingVersion[],
  campaignId: string,
  adsetId: string | null,
  day: string,
): MappingVersion | null {
  if (adsetId !== null) {
    const own = versionInForce(versions, campaignId, adsetId, day);
    if (own && own.kind !== "inherit") return own;
  }
  return versionInForce(versions, campaignId, null, day);
}

/* ─────────────────────────── arithmetic ─────────────────────────── */

/**
 * Split a non-negative integer by weights, largest remainder, ties to the
 * earlier index. All-zero weights split equally: money is never dropped.
 */
export function splitInteger(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wSum = sum > 0 ? sum : w.length;

  const exact = w.map((x) => (total * x) / wSum);
  const parts = exact.map((x) => Math.floor(x));
  let left = total - parts.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) parts[order[k].i] += 1;
  return parts;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The first day whose orders an automatic split on `since` may read. */
export const TRAILING_DAYS = 7;
export function countsWindowStart(since: string): string {
  return shiftDay(since, -TRAILING_DAYS);
}

/** Weights for an automatic split on `day`, and the rule that produced them. */
export function autoWeights(
  productIds: string[],
  day: string,
  counts: OrderCounts,
): { weights: number[]; basis: AllocationBasis } {
  const onDay = counts.get(day);
  const same = productIds.map((p) => onDay?.get(p) ?? 0);
  if (same.some((n) => n > 0)) return { weights: same, basis: "auto_orders" };

  const trailing = productIds.map(() => 0);
  for (let back = 1; back <= TRAILING_DAYS; back++) {
    const byProduct = counts.get(shiftDay(day, -back));
    if (!byProduct) continue;
    productIds.forEach((p, i) => (trailing[i] += byProduct.get(p) ?? 0));
  }
  if (trailing.some((n) => n > 0)) return { weights: trailing, basis: "auto_trailing_7d" };

  return { weights: productIds.map(() => 1), basis: "auto_equal" };
}

/* ─────────────────────────── projection ─────────────────────────── */

const ORIGINAL_UNITS = 10_000; // amount_original is NUMERIC(14,4)

function splitCounter(value: number | null, weights: number[]): (number | null)[] {
  return value === null ? weights.map(() => null) : splitInteger(value, weights);
}

/** One ad set-day → one row per product share (or one unattributed row). */
export function allocateFact(
  fact: AdsetDayFact,
  version: MappingVersion | null,
  counts: OrderCounts,
): AdSpendProjectionRow[] {
  const base = {
    market_id: fact.market_id,
    ad_account_id: fact.ad_account_id,
    period_start: fact.day,
    external_campaign_id: fact.external_campaign_id,
    external_adset_id: fact.external_adset_id,
    campaign_name: fact.campaign_name,
    adset_name: fact.adset_name,
    currency_original: fact.currency_original,
    fx_rate: fact.fx_rate,
    synced_at: fact.synced_at ?? null,
  };

  const whole = (basis: AllocationBasis, productId: string | null): AdSpendProjectionRow[] => [
    {
      ...base,
      product_id: productId,
      amount: fact.amount,
      amount_original: fact.spend_original,
      impressions: fact.impressions,
      reach: fact.reach,
      clicks: fact.clicks,
      frequency: fact.frequency,
      platform_results: fact.platform_results,
      allocation_share: 1,
      allocation_basis: basis,
      mapping_id: basis === "unmapped" ? null : (version?.id ?? null),
    },
  ];

  if (!version || version.kind === "inherit") return whole("unmapped", null);
  if (version.kind === "market_level" || version.lines.length === 0) return whole("market_level", null);
  if (version.lines.length === 1) return whole("single", version.lines[0].product_id);

  const productIds = version.lines.map((l) => l.product_id);
  const { weights, basis } =
    version.split_mode === "manual"
      ? { weights: version.lines.map((l) => l.share_pct ?? 0), basis: "manual" as const }
      : autoWeights(productIds, fact.day, counts);

  const wSum = weights.reduce((a, b) => a + b, 0) || weights.length;
  const amounts = splitInteger(toMillimes(fact.amount), weights);
  const originals = splitInteger(Math.round(fact.spend_original * ORIGINAL_UNITS), weights);
  const impressions = splitCounter(fact.impressions, weights);
  const clicks = splitCounter(fact.clicks, weights);
  const results = splitCounter(fact.platform_results, weights);

  return productIds.map((productId, i) => ({
    ...base,
    product_id: productId,
    amount: fromMillimes(amounts[i]),
    amount_original: originals[i] / ORIGINAL_UNITS,
    impressions: impressions[i],
    reach: null,
    clicks: clicks[i],
    frequency: null,
    platform_results: results[i],
    allocation_share: (weights.every((x) => x === 0) ? 1 : weights[i]) / wSum,
    allocation_basis: basis,
    mapping_id: version.id,
  }));
}

/** Every fact, resolved on its own day. Days with nothing spent are skipped. */
export function projectAdSpend(
  facts: AdsetDayFact[],
  versions: MappingVersion[],
  counts: OrderCounts,
): AdSpendProjectionRow[] {
  const rows: AdSpendProjectionRow[] = [];
  for (const fact of facts) {
    if (!(fact.amount > 0) && !(fact.spend_original > 0)) continue;
    const version = resolveMapping(versions, fact.external_campaign_id, fact.external_adset_id, fact.day);
    rows.push(...allocateFact(fact, version, counts));
  }
  return rows;
}

/** Products any version may need order counts for (automatic splits only). */
export function autoSplitProducts(versions: MappingVersion[]): string[] {
  const ids = new Set<string>();
  for (const version of versions) {
    if (version.kind === "products" && version.lines.length > 1 && version.split_mode !== "manual") {
      version.lines.forEach((l) => ids.add(l.product_id));
    }
  }
  return [...ids];
}

/* ─────────────────────────── preview ─────────────────────────── */

export interface DraftMapping {
  external_campaign_id: string;
  external_adset_id: string | null;
  effective_from: string | null;
  kind: MappingKind;
  split_mode: SplitMode | null;
  lines: MappingLine[];
}

/**
 * The live versions as they will be once `set_ad_spend_mapping` runs — the
 * same supersede rule, in memory, so a preview is computed by the very code
 * that will compute the real rows.
 */
export function withDraft(
  versions: MappingVersion[],
  draft: DraftMapping,
  draftId = "draft",
): MappingVersion[] {
  const kept = versions.filter((version) => {
    const sameTarget =
      version.external_campaign_id === draft.external_campaign_id &&
      version.external_adset_id === draft.external_adset_id;
    if (!sameTarget) return true;
    if (draft.effective_from === null) return false;
    return version.effective_from === null || version.effective_from < draft.effective_from;
  });
  return [
    ...kept,
    {
      id: draftId,
      external_campaign_id: draft.external_campaign_id,
      external_adset_id: draft.external_adset_id,
      effective_from: draft.effective_from,
      kind: draft.kind,
      split_mode: draft.kind === "products" && draft.lines.length > 1 ? draft.split_mode : null,
      lines: draft.kind === "products" ? draft.lines : [],
    },
  ];
}
