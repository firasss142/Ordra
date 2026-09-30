import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  fetchAdsetInsights,
  fetchCatalogue,
  MetaApiError,
  type MetaCatalogue,
  type MetaClientConfig,
} from "./client";
import { normaliseInsightsRow, convertToMarketCurrency, type MetaInsightsRow } from "./insights";
import { rebuildMetaAdSpend, nextHistoryFrom } from "./rebuild";
import { MARKET_TIMEZONES } from "./timezone";
import {
  startRun,
  finishRun,
  failRun,
  recordSkipped,
  reapStaleRuns,
  type SyncTrigger,
} from "./sync-runs";

/**
 * Pull daily AD-SET spend from Meta, then rewrite `ad_spend` from it.
 *
 * Three stages per account, inside one run and one lock:
 *   1. the catalogue — every campaign and ad set, spent or not, so a campaign
 *      can be mapped before its first dinar;
 *   2. the facts — one `meta_adset_daily` row per ad set per day, no product;
 *   3. the projection — `ad_spend`'s meta rows for the window, rewritten whole
 *      from the facts × the mapping in force (lib/meta-ads/rebuild.ts).
 *
 * Decisions that are load-bearing, each arrived at the hard way:
 *
 * **A rolling 7 days, re-fetched every hour.** Meta restates spend for up to
 * ~72h, so a forward-only cursor would freeze the first number it saw, and a
 * missed run heals on the next tick. A fact Meta stops reporting for a
 * re-fetched day is deleted, not left to be counted forever.
 *
 * **`product_id` is still baked into `ad_spend`.** Six read paths and investor
 * accrual key off it and cannot see the mapping tables; the projection keeps
 * them all correct without touching any of them.
 *
 * **A past day keeps the rate it was booked at.** Inside the rolling window the
 * current rate applies (the day is still being restated); before it, the rate
 * already stamped on that day is reused, so re-fetching history — the first run
 * under the ad-set grain re-reads everything since the first synced day — never
 * moves an old figure because today's rate differs.
 *
 * **Unmapped spend still counts.** It lands with `product_id = NULL`, like a
 * market-level manual entry: in the P&L immediately, attribution pending.
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
  /** Meta cuts its days here; the automatic split cuts orders here too. */
  account_timezone: string | null;
  graph_version: string;
  access_token: string;
  last_synced_at: string | null;
  /** Earliest day from which ad-set facts are complete. NULL selects the backfill. */
  adset_history_from: string | null;
  markets?: { code: string } | null;
}

/** How far back each run re-reads. Covers Meta's restatement window with slack. */
export const ROLLING_WINDOW_DAYS = 7;

/**
 * How far back a never-synced account reaches on its first run.
 *
 * The steady-state window is seven days because Meta restates recent spend and
 * re-reading is the only correct answer. But seven days is the wrong window for
 * an account being connected for the first time: the page analyses a 12-week
 * cohort, so a fresh connection would leave every campaign older than a week
 * invisible — and with it every product whose campaigns ran last month, which
 * then reads as "no spend" rather than "not fetched yet". 90 days covers the
 * page's own window with room to spare.
 */
export const BACKFILL_WINDOW_DAYS = 90;

/**
 * Largest range requested in one Insights call.
 *
 * Meta answers an over-large ad set×day request with code 100 / subcode
 * 1487534 rather than truncating, so a long backfill has to arrive in slices.
 * 30 days keeps each call well inside the limit and bounds how much work is
 * lost if one slice fails.
 */
export const MAX_SLICE_DAYS = 30;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDay(d);
}

export function rollingWindow(now: Date, days = ROLLING_WINDOW_DAYS): { since: string; until: string } {
  const until = new Date(now);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return { since: isoDay(since), until: isoDay(until) };
}

/**
 * Split a window into consecutive slices of at most `maxDays`, oldest first.
 *
 * Oldest first matters: if the deadline cuts a backfill short, what landed is a
 * contiguous run from the start of the window, and the next run resumes from a
 * known-good edge rather than leaving a hole in the middle that nothing would
 * ever notice.
 */
export function sliceWindow(
  since: string,
  until: string,
  maxDays = MAX_SLICE_DAYS,
): { since: string; until: string }[] {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const slices: { since: string; until: string }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const sliceEnd = new Date(cursor);
    sliceEnd.setUTCDate(sliceEnd.getUTCDate() + maxDays - 1);
    slices.push({ since: isoDay(cursor), until: isoDay(sliceEnd > end ? end : sliceEnd) });
    cursor.setUTCDate(cursor.getUTCDate() + maxDays);
  }
  return slices;
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

/** The earliest day `ad_spend` holds synced spend for — where a first backfill starts. */
async function earliestMetaDay(adminClient: SupabaseClient, adAccountId: string): Promise<string | null> {
  const { data } = await adminClient
    .from("ad_spend")
    .select("period_start")
    .eq("source", "meta")
    .eq("ad_account_id", adAccountId)
    .order("period_start", { ascending: true })
    .limit(1);
  const first = (data ?? [])[0] as { period_start?: string } | undefined;
  return first?.period_start ?? null;
}

export interface FxStamps {
  /** "<adset id>|<day>" → rate already on that fact. */
  adset: Map<string, number>;
  /** "<campaign id>|<day>" → rate on the legacy campaign-level ad_spend row. */
  campaign: Map<string, number>;
}

async function loadFxStamps(
  adminClient: SupabaseClient,
  adAccountId: string,
  since: string,
  until: string,
): Promise<FxStamps> {
  const stamps: FxStamps = { adset: new Map(), campaign: new Map() };
  if (since > until) return stamps;

  const [facts, legacy] = await Promise.all([
    fetchAllRows<{ external_adset_id: string; day: string; fx_rate: number | string }>(
      adminClient
        .from("meta_adset_daily")
        .select("external_adset_id, day, fx_rate")
        .eq("ad_account_id", adAccountId)
        .gte("day", since)
        .lte("day", until)
        .order("day", { ascending: true }),
    ),
    fetchAllRows<{ external_campaign_id: string | null; period_start: string; fx_rate: number | string | null }>(
      adminClient
        .from("ad_spend")
        .select("external_campaign_id, period_start, fx_rate")
        .eq("source", "meta")
        .eq("ad_account_id", adAccountId)
        .gte("period_start", since)
        .lte("period_start", until)
        .order("period_start", { ascending: true }),
    ),
  ]);
  for (const f of facts) stamps.adset.set(`${f.external_adset_id}|${f.day}`, Number(f.fx_rate));
  for (const l of legacy) {
    if (l.external_campaign_id && l.fx_rate !== null && l.fx_rate !== undefined) {
      stamps.campaign.set(`${l.external_campaign_id}|${l.period_start}`, Number(l.fx_rate));
    }
  }
  return stamps;
}

/**
 * The rate for one fact: today's inside the rolling window, the booked one
 * before it — the fact's own, then the legacy campaign row's — and today's only
 * for an old day nothing was ever booked on.
 */
export function pickFxRate(
  fact: { day: string; adsetId: string; campaignId: string },
  rollingStart: string,
  stamps: FxStamps,
  current: number,
): number {
  if (fact.day >= rollingStart) return current;
  return (
    stamps.adset.get(`${fact.adsetId}|${fact.day}`) ??
    stamps.campaign.get(`${fact.campaignId}|${fact.day}`) ??
    current
  );
}

async function upsertCatalogue(
  adminClient: SupabaseClient,
  account: AdAccountRow,
  catalogue: MetaCatalogue,
  seenAt: string,
): Promise<void> {
  if (catalogue.campaigns.length > 0) {
    const { error } = await adminClient.from("meta_ad_campaigns").upsert(
      catalogue.campaigns.map((c) => ({
        ad_account_id: account.ad_account_id,
        external_campaign_id: c.id,
        market_id: account.market_id,
        name: c.name ?? null,
        objective: c.objective ?? null,
        effective_status: c.effective_status ?? null,
        created_time: c.created_time ?? null,
        last_seen_at: seenAt,
      })),
      { onConflict: "ad_account_id,external_campaign_id" },
    );
    if (error) throw new Error(`meta_ad_campaigns: ${error.message}`);
  }
  if (catalogue.adsets.length > 0) {
    const { error } = await adminClient.from("meta_ad_sets").upsert(
      catalogue.adsets.map((a) => ({
        ad_account_id: account.ad_account_id,
        external_adset_id: a.id,
        external_campaign_id: a.campaign_id,
        market_id: account.market_id,
        name: a.name ?? null,
        effective_status: a.effective_status ?? null,
        created_time: a.created_time ?? null,
        last_seen_at: seenAt,
      })),
      { onConflict: "ad_account_id,external_adset_id" },
    );
    if (error) throw new Error(`meta_ad_sets: ${error.message}`);
  }
}

/** Meta's day boundary for this account: its own timezone, else its market's. */
export function accountTimezone(account: {
  account_timezone: string | null;
  markets?: { code: string } | null;
}): string {
  return (
    account.account_timezone ??
    MARKET_TIMEZONES[(account.markets?.code ?? "").toUpperCase()] ??
    "UTC"
  );
}

/** Sync one ad account. Never throws — every failure is recorded and returned. */
export async function syncAccount(
  adminClient: SupabaseClient,
  account: AdAccountRow,
  opts: {
    trigger: SyncTrigger;
    now?: Date;
    deadlineAt?: number;
    /** Explicit range for a backfill; defaults to the rolling window. */
    window?: { since: string; until: string };
  },
): Promise<SyncAccountResult> {
  const now = opts.now ?? new Date();
  const today = isoDay(now);
  const rollingStart = rollingWindow(now).since;

  // No complete ad-set history yet: reach back to the first synced day, so the
  // projection replaces every legacy campaign-level row, not just a week of them.
  let window = opts.window;
  if (!window) {
    if (account.adset_history_from) {
      window = rollingWindow(now);
    } else {
      const earliest = await earliestMetaDay(adminClient, account.ad_account_id);
      window = {
        since: earliest ?? rollingWindow(now, BACKFILL_WINDOW_DAYS).since,
        until: today,
      };
    }
  }
  const { since, until } = window;

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

  // Every fact this run writes carries this stamp; anything older in the
  // re-fetched range is a fact Meta no longer reports.
  const runStamp = now.toISOString();

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

    // 1. Catalogue.
    await upsertCatalogue(adminClient, account, await fetchCatalogue(cfg), runStamp);

    // 2. Facts, sliced oldest first: a deadline leaves a contiguous prefix.
    const rows: MetaInsightsRow[] = [];
    let accUtilPct: number | null = null;
    let fetchedUntil: string | null = null;
    let cut = false;
    for (const slice of sliceWindow(since, until)) {
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) {
        cut = true;
        break;
      }
      const page = await fetchAdsetInsights(cfg, slice);
      rows.push(...page.rows);
      if (page.accUtilPct !== null) accUtilPct = page.accUtilPct;
      fetchedUntil = slice.until;
    }

    if (!fetchedUntil) {
      await finishRun(adminClient, run.id, {
        rows_fetched: 0,
        rows_upserted: 0,
        rows_errored: 0,
        window_start: since,
        window_end: until,
        acc_util_pct: accUtilPct,
      });
      return { ...base, status: "deadline", acc_util_pct: accUtilPct };
    }

    // Booked rates for the days before the rolling window.
    const lastBooked = dayBefore(rollingStart);
    const stamps = await loadFxStamps(
      adminClient,
      account.ad_account_id,
      since,
      lastBooked < fetchedUntil ? lastBooked : fetchedUntil,
    );

    const payload = rows
      .map((raw) => normaliseInsightsRow(raw))
      .filter((n) => n.externalAdsetId !== null)
      .map((n) => {
        const adsetId = n.externalAdsetId as string;
        const rate = pickFxRate(
          { day: n.date, adsetId, campaignId: n.externalCampaignId },
          rollingStart,
          stamps,
          fxRate,
        );
        return {
          ad_account_id: account.ad_account_id,
          external_adset_id: adsetId,
          day: n.date,
          external_campaign_id: n.externalCampaignId,
          market_id: account.market_id,
          campaign_name: n.campaignName,
          adset_name: n.adsetName,
          spend_original: n.spendOriginal,
          currency_original: n.currency,
          fx_rate: rate,
          amount: convertToMarketCurrency(n.spendOriginal, rate),
          impressions: n.impressions,
          reach: n.reach,
          clicks: n.clicks,
          frequency: n.frequency,
          platform_results: n.platformResults,
          synced_at: runStamp,
        };
      });

    let errored = 0;
    const CHUNK = 200;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const { error } = await adminClient
        .from("meta_adset_daily")
        .upsert(chunk, { onConflict: "ad_account_id,external_adset_id,day" });
      if (error) errored += chunk.length;
    }

    // A partial write leaves this range's facts unreliable: do not project from
    // them. ad_spend keeps its previous, consistent rows; the next run retries.
    if (errored > 0) {
      await finishRun(adminClient, run.id, {
        rows_fetched: rows.length,
        rows_upserted: 0,
        rows_errored: errored,
        window_start: since,
        window_end: until,
        acc_util_pct: accUtilPct,
      });
      return {
        ...base,
        status: "partial",
        rows_fetched: rows.length,
        rows_errored: errored,
        acc_util_pct: accUtilPct,
      };
    }

    // Facts Meta no longer reports for a day it has just re-reported.
    const { error: staleError } = await adminClient
      .from("meta_adset_daily")
      .delete()
      .eq("ad_account_id", account.ad_account_id)
      .gte("day", since)
      .lte("day", fetchedUntil)
      .lt("synced_at", runStamp);
    if (staleError) throw new Error(`meta_adset_daily: ${staleError.message}`);

    // 3. Projection over the whole COMPLETE history, not just the window: the
    //    facts before the window are already complete (adset_history_from says
    //    so), and re-projecting them every hour is what heals a remap whose own
    //    rebuild failed after the mapping was saved. A few thousand rows at most.
    const projectFrom =
      account.adset_history_from && account.adset_history_from < since ? account.adset_history_from : since;
    const written = await rebuildMetaAdSpend(adminClient, {
      adAccountId: account.ad_account_id,
      marketId: account.market_id,
      timezone: accountTimezone(account),
      since: projectFrom,
      until: fetchedUntil,
    });

    await finishRun(adminClient, run.id, {
      rows_fetched: rows.length,
      rows_upserted: written,
      rows_errored: 0,
      window_start: since,
      window_end: until,
      acc_util_pct: accUtilPct,
    });

    await adminClient
      .from("meta_ad_accounts")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
        adset_history_from: cut
          ? account.adset_history_from
          : nextHistoryFrom(account.adset_history_from, { since, until: fetchedUntil }, today),
      })
      .eq("id", account.id);

    return {
      ...base,
      status: cut ? "deadline" : "succeeded",
      rows_fetched: rows.length,
      rows_upserted: written,
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
  opts: {
    trigger: SyncTrigger;
    deadlineAt?: number;
    marketId?: string;
    /** Explicit backfill range, applied to every account in this pass. */
    window?: { since: string; until: string };
  },
): Promise<SyncAccountResult[]> {
  // Must run before anything claims a lock — a run killed mid-flight holds its
  // account forever otherwise.
  await reapStaleRuns(adminClient);

  let query = adminClient
    .from("meta_ad_accounts")
    .select(
      "id, market_id, ad_account_id, account_currency, account_timezone, graph_version, access_token, last_synced_at, adset_history_from, markets(code)",
    )
    .eq("is_active", true);

  if (opts.marketId) query = query.eq("market_id", opts.marketId);

  const { data: accounts, error } = await query;
  if (error) throw error;

  const results: SyncAccountResult[] = [];
  for (const account of (accounts ?? []) as unknown as AdAccountRow[]) {
    if (opts.deadlineAt && Date.now() > opts.deadlineAt) break;
    results.push(await syncAccount(adminClient, account, opts));
  }
  return results;
}
