import type { SupabaseClient } from "@supabase/supabase-js";
import { getSheetsSources } from "./sources-config";
import { getLastRowForStorefront, setLastRowForStorefront } from "./sync-state";
import { fetchSheetRows } from "./client";
import { syncOneStorefront, type SyncResult } from "./sync-engine";
import {
  failRun,
  finishRun,
  recordFailedRow,
  recordSkipped,
  reapStaleRuns,
  startRun,
  type SyncTrigger,
} from "./sync-runs";
import { createOrderFromData } from "@/lib/orders/create-order-from-data";
import type { FetchRowsOptions } from "./types";

/**
 * How long a whole invocation may take before it must hand back.
 *
 * pg_net gives up at 55s and Vercel kills the function at `maxDuration` 60s.
 * Stopping at 40 leaves a margin for the row in flight, the cursor commit and
 * the run record — the three things the old version never reached, which is
 * why it lost every batch it started.
 */
const DEFAULT_BUDGET_MS = 40_000;

export interface RunSyncOptions {
  trigger?: SyncTrigger;
  /** Epoch ms this invocation must finish by. Defaults to now + 40s. */
  deadlineAt?: number;
  maxRowsPerSource?: number;
}

/**
 * Run the Google Sheets sync for one market, recording what happened.
 *
 * Sources are walked in order against a shared deadline: with two sheets
 * configured, the second must not be starved by the first, but neither may
 * push the invocation past the platform limit. Whatever is not reached this
 * pass is picked up by the next one from a cursor that is now committed per
 * row rather than per batch.
 */
export async function runSyncForMarket(
  adminClient: SupabaseClient,
  marketId: string,
  options: RunSyncOptions = {},
): Promise<SyncResult[]> {
  const trigger = options.trigger ?? "manual";
  const deadlineAt = options.deadlineAt ?? Date.now() + DEFAULT_BUDGET_MS;

  // A previous invocation killed mid-flight still holds its lock. Clear those
  // before claiming, or the sync stops forever the first time it is killed.
  await reapStaleRuns(adminClient);

  const sources = await getSheetsSources(adminClient, marketId);
  const results: SyncResult[] = [];

  for (const source of sources) {
    const run = await startRun(adminClient, {
      marketId,
      storefrontId: source.storefront_id,
      trigger,
    });

    if (!run) {
      await recordSkipped(adminClient, {
        marketId,
        storefrontId: source.storefront_id,
        trigger,
      });
      continue;
    }

    const config = { ...source, market_id: marketId };

    try {
      const result = await syncOneStorefront(
        config,
        {
          fetchRows: (opts: FetchRowsOptions) => fetchSheetRows(opts),
          processRow: async ({ storefront, orderData, rawRow }) => {
            return createOrderFromData({
              adminClient,
              storefront,
              orderData,
              rawPayload: rawRow.data as Record<string, unknown>,
              sourceNote: "Order received via Google Sheets sync",
            });
          },
          getLastRow: (storefrontId) =>
            getLastRowForStorefront(adminClient, marketId, storefrontId),
          setLastRow: (storefrontId, lastRow) =>
            setLastRowForStorefront(adminClient, marketId, storefrontId, lastRow),
          recordFailure: (failure) =>
            recordFailedRow(adminClient, {
              runId: run.id,
              marketId,
              storefrontId: failure.storefrontId,
              rowIndex: failure.rowIndex,
              rawRow: failure.rawRow,
              message: failure.message,
            }),
        },
        { deadlineAt, maxRows: options.maxRowsPerSource },
      );

      await finishRun(adminClient, run.id, result);
      results.push(result);
    } catch (err) {
      // The sheet was unreachable, the credentials expired, the tab was
      // renamed. Recorded against the run so the storefront page can say so
      // instead of showing a cursor that quietly stopped moving.
      const message = err instanceof Error ? err.message : String(err);
      await failRun(adminClient, run.id, message);
      results.push({
        storefront_id: source.storefront_id,
        rows_fetched: 0,
        rows_imported: 0,
        rows_duplicate: 0,
        rows_errored: 1,
        last_row: 0,
        has_more: false,
        errors: [{ row: 0, message }],
      });
    }

    if (Date.now() >= deadlineAt) break;
  }

  return results;
}
