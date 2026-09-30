import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  projectAdSpend,
  autoSplitProducts,
  countsWindowStart,
  type AdsetDayFact,
  type AdSpendProjectionRow,
  type MappingVersion,
  type OrderCounts,
} from "@/lib/ad-spend/allocation";

/**
 * Rewrite `ad_spend`'s meta rows from the raw facts and the mapping in force.
 *
 * SERVER-SIDE ONLY (service role). The arithmetic lives in
 * `lib/ad-spend/allocation.ts`; this module only loads its inputs and hands the
 * result to `replace_meta_ad_spend`, which deletes and inserts the whole scope in
 * one transaction — a failure leaves the previous rows exactly as they were.
 *
 * Two callers: the sync, over the window it has just fetched, and the mapping
 * route, over the campaign it has just remapped. Both must keep the rewrite
 * inside the account's complete ad-set history (`clampToHistory`) — rewriting a
 * day whose facts were never fetched deletes its old row and puts nothing back.
 */

interface VersionRow {
  id: string;
  external_campaign_id: string;
  external_adset_id: string | null;
  effective_from: string | null;
  kind: MappingVersion["kind"];
  split_mode: MappingVersion["split_mode"];
}

interface LineRow {
  mapping_id: string;
  product_id: string;
  share_pct: number | string | null;
}

/** The live (not superseded) versions of an account, with their lines. */
export async function loadLiveVersions(
  admin: SupabaseClient,
  adAccountId: string,
): Promise<MappingVersion[]> {
  const { data, error } = await admin
    .from("ad_spend_mappings")
    .select("id, external_campaign_id, external_adset_id, effective_from, kind, split_mode")
    .eq("ad_account_id", adAccountId)
    .is("superseded_at", null);
  if (error) throw new Error(`ad_spend_mappings: ${error.message}`);

  const versions = (data ?? []) as VersionRow[];
  if (versions.length === 0) return [];

  const { data: lineData, error: lineError } = await admin
    .from("ad_spend_mapping_lines")
    .select("mapping_id, product_id, share_pct")
    .in(
      "mapping_id",
      versions.map((v) => v.id),
    );
  if (lineError) throw new Error(`ad_spend_mapping_lines: ${lineError.message}`);

  const byVersion = new Map<string, LineRow[]>();
  for (const line of (lineData ?? []) as LineRow[]) {
    const list = byVersion.get(line.mapping_id);
    if (list) list.push(line);
    else byVersion.set(line.mapping_id, [line]);
  }

  return versions.map((v) => ({
    ...v,
    // Sorted so a rebuild always hands the leftover millime to the same product.
    lines: (byVersion.get(v.id) ?? [])
      .map((l) => ({ product_id: l.product_id, share_pct: l.share_pct == null ? null : Number(l.share_pct) }))
      .sort((a, b) => a.product_id.localeCompare(b.product_id)),
  }));
}

const FACT_COLUMNS =
  "ad_account_id, market_id, external_campaign_id, external_adset_id, campaign_name, adset_name, day, amount, spend_original, currency_original, fx_rate, impressions, reach, clicks, frequency, platform_results, synced_at";

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Raw ad set-days of an account over a window, optionally for some campaigns. */
export async function loadFacts(
  admin: SupabaseClient,
  q: { adAccountId: string; since: string; until: string; campaignIds?: string[] },
): Promise<AdsetDayFact[]> {
  let query = admin
    .from("meta_adset_daily")
    .select(FACT_COLUMNS)
    .eq("ad_account_id", q.adAccountId)
    .gte("day", q.since)
    .lte("day", q.until);
  if (q.campaignIds) query = query.in("external_campaign_id", q.campaignIds);

  const rows = await fetchAllRows<Record<string, unknown>>(
    query.order("day", { ascending: true }).order("external_adset_id", { ascending: true }),
  );
  return rows.map((r) => ({
    ad_account_id: String(r.ad_account_id),
    market_id: String(r.market_id),
    external_campaign_id: String(r.external_campaign_id),
    external_adset_id: String(r.external_adset_id),
    campaign_name: (r.campaign_name as string | null) ?? null,
    adset_name: (r.adset_name as string | null) ?? null,
    day: String(r.day),
    amount: Number(r.amount) || 0,
    spend_original: Number(r.spend_original) || 0,
    currency_original: String(r.currency_original),
    fx_rate: Number(r.fx_rate),
    impressions: numOrNull(r.impressions),
    reach: numOrNull(r.reach),
    clicks: numOrNull(r.clicks),
    frequency: numOrNull(r.frequency),
    platform_results: numOrNull(r.platform_results),
    synced_at: (r.synced_at as string | null) ?? null,
  }));
}

/** Orders per product per day (ad account timezone) — the automatic split's weights. */
export async function loadOrderCounts(
  admin: SupabaseClient,
  q: { marketId: string; since: string; until: string; timezone: string; productIds: string[] },
): Promise<OrderCounts> {
  const counts: OrderCounts = new Map();
  if (q.productIds.length === 0) return counts;

  const { data, error } = await admin.rpc("order_counts_by_product_day", {
    p_market_id: q.marketId,
    p_since: q.since,
    p_until: q.until,
    p_tz: q.timezone,
    p_product_ids: q.productIds,
  });
  if (error) throw new Error(`order_counts_by_product_day: ${(error as { message: string }).message}`);

  for (const row of (data ?? []) as { day: string; product_id: string; orders: number }[]) {
    const day = String(row.day).slice(0, 10);
    let byProduct = counts.get(day);
    if (!byProduct) counts.set(day, (byProduct = new Map()));
    byProduct.set(row.product_id, Number(row.orders) || 0);
  }
  return counts;
}

export interface RebuildScope {
  adAccountId: string;
  marketId: string;
  /** The ad account's timezone — Meta cuts its days there, so orders must be too. */
  timezone: string;
  since: string;
  until: string;
  /** Limit the rewrite to these campaigns; omit for the whole account. */
  campaignIds?: string[];
  /** Pre-loaded live versions, e.g. with a draft applied for a preview. */
  versions?: MappingVersion[];
}

/** The rows the scope WOULD hold — no write. Shared by the rebuild and the preview. */
export async function computeProjection(
  admin: SupabaseClient,
  scope: RebuildScope,
): Promise<AdSpendProjectionRow[]> {
  const [facts, versions] = await Promise.all([
    loadFacts(admin, scope),
    scope.versions ? Promise.resolve(scope.versions) : loadLiveVersions(admin, scope.adAccountId),
  ]);
  const counts = await loadOrderCounts(admin, {
    marketId: scope.marketId,
    since: countsWindowStart(scope.since),
    until: scope.until,
    timezone: scope.timezone,
    productIds: autoSplitProducts(versions),
  });
  return projectAdSpend(facts, versions, counts);
}

/** Rewrite the scope's meta rows atomically. Returns the rows written. */
export async function rebuildMetaAdSpend(admin: SupabaseClient, scope: RebuildScope): Promise<number> {
  const rows = await computeProjection(admin, scope);
  const { data, error } = await admin.rpc("replace_meta_ad_spend", {
    p_ad_account_id: scope.adAccountId,
    p_since: scope.since,
    p_until: scope.until,
    p_campaign_ids: scope.campaignIds ?? null,
    p_rows: rows,
  });
  if (error) throw new Error(`replace_meta_ad_spend: ${(error as { message: string }).message}`);
  return typeof data === "number" ? data : rows.length;
}

/**
 * Keep a rewrite inside the complete ad-set history. null = nothing may be
 * rewritten: either no history exists yet, or the window ends before it starts.
 */
export function clampToHistory(
  since: string,
  until: string,
  historyFrom: string | null,
): { since: string; until: string } | null {
  if (!historyFrom) return null;
  const from = since < historyFrom ? historyFrom : since;
  return from > until ? null : { since: from, until };
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The account's complete-history start after a CLEAN run over `run`.
 *
 * History means "complete from here to today", so a run can only start one if
 * it reached (at least) yesterday, and can only extend one it touches — a
 * backfill that leaves a gap before the existing history proves nothing about
 * the gap.
 */
export function nextHistoryFrom(
  current: string | null,
  run: { since: string; until: string },
  today: string,
): string | null {
  if (current === null) return run.until >= dayBefore(today) ? run.since : null;
  if (run.since < current && run.until >= dayBefore(current)) return run.since;
  return current;
}
