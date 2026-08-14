import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import {
  fetchCampaignInsights,
  MetaApiError,
  type MetaClientConfig,
} from "./client";
import {
  normaliseInsightsRow,
  extractLeadCount,
  convertToMarketCurrency,
} from "./insights";
import {
  startRun,
  finishRun,
  failRun,
  recordSkipped,
  reapStaleRuns,
  type SyncTrigger,
} from "./sync-runs";

/**
 * Pull campaign-level daily spend from Meta into `ad_spend`.
 *
 * Three decisions here are load-bearing and were each arrived at the hard way.
 *
 * **The window is a rolling 7 days, re-fetched every hour.** Meta restates
 * spend for up to ~72h after the fact, so a forward-only cursor would freeze
 * the first number it ever saw. Re-fetching also means a missed run heals
 * itself on the next tick rather than leaving a hole, which is what lets the
 * stale-run reaper get away with an hour of recovery latency.
 *
 * **`product_id` is baked at write time, not resolved at read time.** Six
 * separate read paths key directly off `ad_spend.product_id` — products/metrics,
 * two product-profitability routes, the investor rollup, the settlements route,
 * and the ad-spend route itself — and none of them can see
 * `meta_campaign_mappings`. Leaving synced rows NULL would zero every
 * per-product figure and, worse, sweep the whole synced spend into
 * `marketWideAdSpend`, where settlement redistributes it pro-rata by revenue and
 * silently overwrites human-declared attribution inside investor payouts.
 * Re-mapping a campaign therefore re-stamps its history (see
 * `restampMappedProduct`), which keeps the retroactive-correction property that
 * made read-time joins attractive in the first place.
 *
 * **Unmapped campaigns still count.** They land with `product_id = NULL`, which
 * is exactly how a market-level manual entry behaves, so the money reaches the
 * P&L immediately and only its attribution is pending. Hiding it until someone
 * maps it would understate costs and overstate profit — the one direction a
 * finance surface must never round.
 */

export interface SyncAccountResult {
  ad_account_id: string;
  status: "succeeded" | "partial" | "failed" | "skipped_locked" | "deadline";
  rows_fetched: number;
  rows_upserted: number;
  rows_errored: number;
  acc_util_pct: number | null;
  error?: string;
}

interface AdAccountRow {
  id: string;
  market_id: string;
  ad_account_id: string;
  account_currency: string;
  graph_version: string;
  access_token: string;
}

/** How far back each run re-reads. Covers Meta's restatement window with slack. */
export const ROLLING_WINDOW_DAYS = 7;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function rollingWindow(now: Date, days = ROLLING_WINDOW_DAYS): { since: string; until: string } {
  const until = new Date(now);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since: isoDay(since), until: isoDay(until) };
}

/**
 * The FX rate that turns Meta's billing currency into the market's.
 *
 * Deliberately a manual setting rather than a live feed: the official rate is
 * not the rate this business actually pays, and a finance page that quietly
 * disagrees with the bank statement is worse than one that asks to be told.
 * The rate in force at sync time is stamped onto every row, so correcting it
 * later never rewrites history.
 */
export async function loadFxRate(
  adminClient: SupabaseClient,
  marketId: string,
  currency: string,
): Promise<number | null> {
  const { data } = await adminClient
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "ad_spend_fx_rates")
    .maybeSingle();

  const rates = (data?.value ?? null) as Record<string, number> | null;
  const rate = rates?.[currency];
  return typeof rate === "number" && rate > 0 ? rate : null;
}

/** campaign_id → product_id, for the accounts a human has already mapped. */
async function loadMappings(
  adminClient: SupabaseClient,
  adAccountId: string,
): Promise<Map<string, string | null>> {
  const { data } = await adminClient
    .from("meta_campaign_mappings")
    .select("external_campaign_id, product_id")
    .eq("ad_account_id", adAccountId);

  const map = new Map<string, string | null>();
  for (const row of data ?? []) {
    map.set(row.external_campaign_id as string, (row.product_id as string | null) ?? null);
  }
  return map;
}

/**
 * Re-stamp every synced row for a campaign after someone maps or re-maps it.
 *
 * This is what buys back the retroactive correction that a read-time join would
 * have given for free. Called by the mapping route, not by the sync.
 */
export async function restampMappedProduct(
  adminClient: SupabaseClient,
  params: { adAccountId: string; externalCampaignId: string; productId: string | null },
): Promise<number> {
  const { data } = await adminClient
    .from("ad_spend")
    .update({ product_id: params.productId })
    .eq("source", "meta")
    .eq("ad_account_id", params.adAccountId)
    .eq("external_campaign_id", params.externalCampaignId)
    .select("id");

  return data?.length ?? 0;
}

/** Sync one ad account. Never throws — every failure is recorded and returned. */
export async function syncAccount(
  adminClient: SupabaseClient,
  account: AdAccountRow,
  opts: { trigger: SyncTrigger; now?: Date; deadlineAt?: number },
): Promise<SyncAccountResult> {
  const now = opts.now ?? new Date();
  const { since, until } = rollingWindow(now);

  const base = {
    ad_account_id: account.ad_account_id,
    rows_fetched: 0,
    rows_upserted: 0,
    rows_errored: 0,
    acc_util_pct: null as number | null,
  };

  const run = await startRun(adminClient, {
    marketId: account.market_id,
    adAccountId: account.ad_account_id,
    trigger: opts.trigger,
    windowStart: since,
    windowEnd: until,
  });

  if (!run) {
    await recordSkipped(adminClient, {
      marketId: account.market_id,
      adAccountId: account.ad_account_id,
      trigger: opts.trigger,
      windowStart: since,
      windowEnd: until,
    });
    return { ...base, status: "skipped_locked" };
  }

  try {
    const fxRate =
      account.account_currency === "LYD" || account.account_currency === "TND"
        ? 1
        : await loadFxRate(adminClient, account.market_id, account.account_currency);

    if (fxRate === null) {
      throw new Error(
        `No FX rate configured for ${account.account_currency} in this market — ` +
          `set settings.ad_spend_fx_rates before syncing, or spend would be stored at face value.`,
      );
    }

    const cfg: MetaClientConfig = {
      adAccountId: account.ad_account_id,
      accessToken: decrypt(account.access_token),
      graphVersion: account.graph_version,
    };

    const { rows, accUtilPct } = await fetchCampaignInsights(cfg, { since, until });
    const mappings = await loadMappings(adminClient, account.ad_account_id);

    const payload = rows.map((raw) => {
      const n = normaliseInsightsRow(raw);
      return {
        market_id: account.market_id,
        // Baked, not joined — see the note at the top of this file.
        product_id: mappings.get(n.externalCampaignId) ?? null,
        amount: convertToMarketCurrency(n.spendOriginal, fxRate),
        amount_original: n.spendOriginal,
        currency_original: n.currency,
        fx_rate: fxRate,
        // Synced rows are a single day: period_start === period_end. Every
        // existing overlap predicate (period_start <= to AND period_end >= from)
        // already handles that without change.
        period_start: n.date,
        period_end: n.date,
        source: "meta",
        ad_account_id: account.ad_account_id,
        external_campaign_id: n.externalCampaignId,
        campaign_name: n.campaignName,
        impressions: n.impressions,
        reach: n.reach,
        clicks: n.clicks,
        frequency: n.frequency,
        platform_results: n.platformResults,
        synced_at: new Date().toISOString(),
        // `is_active` is deliberately NOT in this payload. The arbiter is a total
        // index, so ON CONFLICT lands on DO UPDATE and PostgREST writes every
        // column the body carries — including this one. Sending `true` would
        // resurrect a row a human had soft-deleted, on the very next hourly tick,
        // silently and forever. Absent from the body, the existing value stands
        // and the column default only applies to genuinely new rows.
        // created_by stays NULL: a cron has no human creator, which is why the
        // column's NOT NULL was dropped rather than a system user invented.
      };
    });

    let upserted = 0;
    let errored = 0;

    // Chunked so one oversized request cannot blow the 45s budget, and so a
    // single bad day fails its chunk instead of the whole window.
    const CHUNK = 200;
    for (let i = 0; i < payload.length; i += CHUNK) {
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) {
        await finishRun(adminClient, run.id, {
          rows_fetched: rows.length,
          rows_upserted: upserted,
          rows_errored: errored,
          window_start: since,
          window_end: until,
          acc_util_pct: accUtilPct,
        });
        return { ...base, status: "deadline", rows_fetched: rows.length, rows_upserted: upserted, rows_errored: errored, acc_util_pct: accUtilPct };
      }

      const chunk = payload.slice(i, i + CHUNK);
      const { error } = await adminClient
        .from("ad_spend")
        .upsert(chunk, {
          // Non-partial index — PostgREST emits column names only and cannot
          // infer a predicate (42P10).
          onConflict: "source,ad_account_id,external_campaign_id,period_start",
        });

      if (error) errored += chunk.length;
      else upserted += chunk.length;
    }

    await finishRun(adminClient, run.id, {
      rows_fetched: rows.length,
      rows_upserted: upserted,
      rows_errored: errored,
      window_start: since,
      window_end: until,
      acc_util_pct: accUtilPct,
    });

    await adminClient
      .from("meta_ad_accounts")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", account.id);

    return {
      ...base,
      status: errored > 0 ? "partial" : "succeeded",
      rows_fetched: rows.length,
      rows_upserted: upserted,
      rows_errored: errored,
      acc_util_pct: accUtilPct,
    };
  } catch (err) {
    const message =
      err instanceof MetaApiError
        ? `Meta API error ${err.code}${err.subcode ? `/${err.subcode}` : ""}: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Unknown error";

    await failRun(adminClient, run.id, message);

    // Mirrored onto the account because that is what the settings page and the
    // sync-health strip read. A revoked token must not look like a quiet zero.
    await adminClient
      .from("meta_ad_accounts")
      .update({ last_sync_error: message.slice(0, 2000) })
      .eq("id", account.id);

    return { ...base, status: "failed", error: message };
  }
}

/** Sync every active account, sequentially, inside one shared time budget. */
export async function syncAllAccounts(
  adminClient: SupabaseClient,
  opts: { trigger: SyncTrigger; deadlineAt?: number; marketId?: string },
): Promise<SyncAccountResult[]> {
  // Must run before anything claims a lock — a run killed mid-flight holds its
  // account forever otherwise.
  await reapStaleRuns(adminClient);

  let query = adminClient
    .from("meta_ad_accounts")
    .select("id, market_id, ad_account_id, account_currency, graph_version, access_token")
    .eq("is_active", true);

  if (opts.marketId) query = query.eq("market_id", opts.marketId);

  const { data: accounts, error } = await query;
  if (error) throw error;

  const results: SyncAccountResult[] = [];
  for (const account of (accounts ?? []) as AdAccountRow[]) {
    if (opts.deadlineAt && Date.now() > opts.deadlineAt) break;
    results.push(await syncAccount(adminClient, account, opts));
  }
  return results;
}
