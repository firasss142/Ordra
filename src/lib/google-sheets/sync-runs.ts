import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncResult } from "./sync-engine";

/**
 * The record of what the sync did, and the lock that stops two of them doing
 * it at once.
 *
 * Both exist because the old sync had neither. Its only output was a JSON body
 * returned to pg_net, which discards it, so a run that imported nothing and a
 * run that failed on every row were indistinguishable from outside — for four
 * days they were in fact the same run, failing identically, and the first
 * person to notice was the operator counting rows in the spreadsheet.
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

/**
 * Claim the storefront and open a run.
 *
 * `null` means another run holds it. The claim is a unique partial index on
 * (storefront_id) WHERE status = 'running', so the exclusion happens in
 * Postgres: a check-then-insert in application code loses this race exactly
 * when it matters, which is when a run has overrun its window and the next
 * cron tick lands on top of it. Two workers walking one cursor double-import.
 */
export async function startRun(
  adminClient: SupabaseClient,
  params: { marketId: string; storefrontId: string; trigger: SyncTrigger },
): Promise<StartedRun | null> {
  const { data, error } = await adminClient
    .from("sheet_sync_runs")
    .insert({
      market_id: params.marketId,
      storefront_id: params.storefrontId,
      trigger: params.trigger,
      status: "running",
    })
    .select("id")
    .single();

  // 23505 = unique_violation: someone else is already running this storefront.
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }

  return { id: data.id as string };
}

/**
 * Close a run with what it managed.
 *
 * `partial` is its own status, distinct from `failed`: a pass that imported
 * forty rows and choked on one is not a broken sync, but it is not a clean one
 * either, and the storefront page needs to be able to say which.
 */
export async function finishRun(
  adminClient: SupabaseClient,
  runId: string,
  result: SyncResult,
): Promise<void> {
  await adminClient
    .from("sheet_sync_runs")
    .update({
      status: result.rows_errored > 0 ? "partial" : "succeeded",
      finished_at: new Date().toISOString(),
      rows_fetched: result.rows_fetched,
      rows_imported: result.rows_imported,
      rows_duplicate: result.rows_duplicate,
      rows_errored: result.rows_errored,
      last_row: result.last_row,
      has_more: result.has_more,
    })
    .eq("id", runId);
}

/** Close a run that threw — the sheet was unreachable, credentials expired. */
export async function failRun(
  adminClient: SupabaseClient,
  runId: string,
  message: string,
): Promise<void> {
  await adminClient
    .from("sheet_sync_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error: message.slice(0, 2000),
    })
    .eq("id", runId);
}

/** Note that a storefront was busy, so a silent gap is not mistaken for calm. */
export async function recordSkipped(
  adminClient: SupabaseClient,
  params: { marketId: string; storefrontId: string; trigger: SyncTrigger },
): Promise<void> {
  await adminClient.from("sheet_sync_runs").insert({
    market_id: params.marketId,
    storefront_id: params.storefrontId,
    trigger: params.trigger,
    status: "skipped_locked",
    finished_at: new Date().toISOString(),
  });
}

/**
 * Keep a row that could not be imported, with the data it was read from.
 *
 * Upserted on (storefront_id, row_index), so a row re-read by a later run
 * updates its reason instead of accumulating duplicates — and a row that had
 * been marked resolved but failed again is reopened, because it is outstanding
 * once more.
 *
 * The key deliberately is not partial. `ON CONFLICT` cannot target a partial
 * unique index through PostgREST (42P10), and the first version of this table
 * shipped with one: every failed row would have thrown, skipping the cursor
 * commit and stalling the sync on the first bad row.
 */
export async function recordFailedRow(
  adminClient: SupabaseClient,
  params: {
    runId: string;
    marketId: string;
    storefrontId: string;
    rowIndex: number;
    rawRow: Record<string, unknown>;
    message: string;
  },
): Promise<void> {
  await adminClient.from("sheet_sync_failed_rows").upsert(
    {
      run_id: params.runId,
      market_id: params.marketId,
      storefront_id: params.storefrontId,
      row_index: params.rowIndex,
      raw_row: params.rawRow,
      message: params.message.slice(0, 2000),
      resolved_at: null,
    },
    { onConflict: "storefront_id,row_index" },
  );
}

/**
 * Release a run left `running` by a process that died mid-flight.
 *
 * Without this the unique index becomes a deadlock: the row that holds the
 * lock is never closed, and every later run is skipped forever. A platform
 * kill is exactly the failure this whole module exists because of, so the
 * recovery path is not hypothetical.
 */
export async function reapStaleRuns(
  adminClient: SupabaseClient,
  olderThanMinutes = 10,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();

  const { data } = await adminClient
    .from("sheet_sync_runs")
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
