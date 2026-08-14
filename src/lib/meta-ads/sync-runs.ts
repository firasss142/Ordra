import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The record of what the Meta sync did, and the lock that stops two of them
 * doing it at once.
 *
 * This is a deliberate copy of `google-sheets/sync-runs.ts`, for the same
 * reason that module exists: a cron whose only output is a JSON body returned
 * to pg_net is a cron nobody can audit, because pg_net discards the body and
 * `cron.job_run_details` reports "succeeded" for a request that timed out.
 * That failure ran undetected for four days on the sheets sync. Ad spend feeds
 * the P&L and every investor settlement, so a silent zero here is worse.
 *
 * One difference from the sheets version is worth stating, because it looks
 * like an inconsistency and is not. The in-flight lock below IS a partial
 * unique index; the idempotency key on `ad_spend` deliberately is NOT. The two
 * are used differently: this one is a plain INSERT whose 23505 we catch, so
 * Postgres can infer nothing and a predicate is free. The `ad_spend` key is an
 * `ON CONFLICT` arbiter reached through PostgREST, which emits column names
 * only and fails 42P10 against a partial index — a bug this repo already
 * shipped once (20260812141346_sheet_sync_failed_rows_upsertable_key.sql).
 */

export type SyncTrigger = "cron" | "manual";

export type SyncRunStatus =
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped_locked";

export interface StartedRun {
  id: string;
}

export interface SyncRunResult {
  rows_fetched: number;
  rows_upserted: number;
  rows_errored: number;
  window_start: string;
  window_end: string;
  acc_util_pct: number | null;
}

/**
 * Claim the ad account and open a run.
 *
 * `null` means another run holds it. The exclusion happens in Postgres via a
 * unique partial index on (ad_account_id) WHERE status = 'running': a
 * check-then-insert in application code loses this race exactly when it
 * matters, which is when a run has overrun its window and the next hourly tick
 * lands on top of it.
 */
export async function startRun(
  adminClient: SupabaseClient,
  params: {
    marketId: string;
    adAccountId: string;
    trigger: SyncTrigger;
    windowStart: string;
    windowEnd: string;
  },
): Promise<StartedRun | null> {
  const { data, error } = await adminClient
    .from("ad_sync_runs")
    .insert({
      market_id: params.marketId,
      ad_account_id: params.adAccountId,
      trigger: params.trigger,
      status: "running",
      window_start: params.windowStart,
      window_end: params.windowEnd,
    })
    .select("id")
    .single();

  // 23505 = unique_violation: someone else is already syncing this account.
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }

  return { id: data.id as string };
}

/**
 * Close a run with what it managed.
 *
 * `partial` is its own status: a pass that upserted thirty days and choked on
 * one is not a broken sync, but the sync-health strip must not call it clean
 * either.
 */
export async function finishRun(
  adminClient: SupabaseClient,
  runId: string,
  result: SyncRunResult,
): Promise<void> {
  await adminClient
    .from("ad_sync_runs")
    .update({
      status: result.rows_errored > 0 ? "partial" : "succeeded",
      finished_at: new Date().toISOString(),
      rows_fetched: result.rows_fetched,
      rows_upserted: result.rows_upserted,
      rows_errored: result.rows_errored,
      acc_util_pct: result.acc_util_pct,
    })
    .eq("id", runId);
}

/**
 * Close a run that threw — token revoked, account disabled, Meta unreachable.
 *
 * The message is also mirrored onto `meta_ad_accounts.last_sync_error` by the
 * caller, because that is what the settings page reads. An invalid token
 * (code 190) silently zeroes every ROAS on the finance page, so it has to
 * surface somewhere a human looks.
 */
export async function failRun(
  adminClient: SupabaseClient,
  runId: string,
  message: string,
): Promise<void> {
  await adminClient
    .from("ad_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: message.slice(0, 2000),
    })
    .eq("id", runId);
}

/** Note that an account was busy, so a silent gap is not mistaken for calm. */
export async function recordSkipped(
  adminClient: SupabaseClient,
  params: {
    marketId: string;
    adAccountId: string;
    trigger: SyncTrigger;
    windowStart: string;
    windowEnd: string;
  },
): Promise<void> {
  await adminClient.from("ad_sync_runs").insert({
    market_id: params.marketId,
    ad_account_id: params.adAccountId,
    trigger: params.trigger,
    status: "skipped_locked",
    window_start: params.windowStart,
    window_end: params.windowEnd,
    finished_at: new Date().toISOString(),
  });
}

/**
 * Release a run left `running` by a process that died mid-flight.
 *
 * Without this the unique index becomes a deadlock: the row holding the lock is
 * never closed and every later run is skipped forever. The sheets sync learned
 * this the hard way, and a new table inherits nothing — there is no DB-side
 * reaper, no trigger, no job. It must be called at the top of every run.
 *
 * Recovery latency is honestly one hour, not `olderThanMinutes`: reaping only
 * happens when a run happens, and runs are hourly. That is tolerable here only
 * because the window is a rolling 7 days, so the next successful run re-fetches
 * everything the dead one would have. A forward-only cursor could not take
 * this trade.
 */
export async function reapStaleRuns(
  adminClient: SupabaseClient,
  olderThanMinutes = 10,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data } = await adminClient
    .from("ad_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: "Run did not report back — process was killed before it finished",
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  return data?.length ?? 0;
}
