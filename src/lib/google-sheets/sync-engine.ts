import type { SheetRow, FetchRowsOptions } from "./types";
import type { CreateOrderResult } from "@/lib/orders/create-order-from-data";
import { getSheetsAdapter } from "@/lib/storefronts/sheets/adapter-registry";

/**
 * One pass of the Google Sheets import.
 *
 * The version this replaces could not finish, and could not fail safely
 * either. It read every row of the sheet, imported them one at a time with no
 * regard for how long it had, and committed the cursor exactly once — after
 * the loop. pg_net kills the request at 55 seconds, so on the live market the
 * loop never reached the commit: every fifteen minutes it restarted from the
 * same cursor, redid the same work and died in the same place. The cursor sat
 * at row 2834 for four days while the cron reported success 384 times.
 *
 * Three rules now hold, and each one is load-bearing:
 *
 * 1. **The cursor is committed per row, not per batch.** Whatever the run
 *    manages before it is killed is kept. Progress can no longer be undone by
 *    a timeout, which is what made the old failure permanent rather than
 *    transient.
 * 2. **The run stops before its deadline, not when it runs out of rows.** It
 *    returns `has_more` and the next run continues. A backlog is drained over
 *    several passes instead of failing forever in one.
 * 3. **A row that cannot be imported is written down before it is stepped
 *    over.** The old loop advanced the cursor at the top of the body, so a row
 *    that failed to map was skipped permanently and the only trace was an
 *    `errors` array returned to pg_net, which discards it.
 */

export interface SheetSyncConfig {
  storefront_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  platform: string;
  is_active: boolean;
  market_id: string;
}

export interface SyncResult {
  storefront_id: string;
  rows_fetched: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_errored: number;
  /** Rows the adapter said to leave out (e.g. Converty `deleted`). Not errors. */
  rows_skipped: number;
  last_row: number;
  /** The window filled up or the deadline hit with rows still to read. */
  has_more: boolean;
  errors: Array<{ row: number; message: string }>;
}

export interface ProcessRowParams {
  storefront: { id: string; market_id: string };
  orderData: ReturnType<ReturnType<typeof getSheetsAdapter>["mapRow"]>;
  rawRow: SheetRow;
}

export interface RecordFailureParams {
  storefrontId: string;
  rowIndex: number;
  rawRow: Record<string, unknown>;
  message: string;
}

export interface SyncEngineDeps {
  fetchRows: (opts: FetchRowsOptions) => Promise<SheetRow[]>;
  processRow: (params: ProcessRowParams) => Promise<CreateOrderResult>;
  getLastRow: (storefrontId: string) => Promise<number>;
  setLastRow: (storefrontId: string, lastRow: number) => Promise<void>;
  /** Persist a row that could not be imported, so it is retryable. */
  recordFailure?: (params: RecordFailureParams) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
}

export interface SyncEngineOptions {
  /**
   * Epoch ms after which no new row is started.
   *
   * Not a cancellation — a row already in flight finishes, because abandoning
   * a half-written order is worse than overrunning by one row. The caller sets
   * this far enough inside the platform limit to absorb that.
   */
  deadlineAt?: number;
  /** Rows to request in this pass. Bounds the fetch as well as the loop. */
  maxRows?: number;
}

/** Time to leave for one more row plus the commit, when deciding to stop. */
const ROW_BUDGET_MS = 4_000;

export async function syncOneStorefront(
  config: SheetSyncConfig,
  deps: SyncEngineDeps,
  options: SyncEngineOptions = {},
): Promise<SyncResult> {
  const now = deps.now ?? Date.now;

  const empty: SyncResult = {
    storefront_id: config.storefront_id,
    rows_fetched: 0,
    rows_imported: 0,
    rows_duplicate: 0,
    rows_errored: 0,
    rows_skipped: 0,
    last_row: 0,
    has_more: false,
    errors: [],
  };

  if (!config.is_active) return empty;

  const lastRow = await deps.getLastRow(config.storefront_id);
  const rows = await deps.fetchRows({
    spreadsheetId: config.spreadsheet_id,
    sheetName: config.sheet_name,
    fromRow: lastRow + 1,
    maxRows: options.maxRows,
  });

  if (rows.length === 0) return { ...empty, last_row: lastRow };

  const adapter = getSheetsAdapter(config.platform);
  const storefront = { id: config.storefront_id, market_id: config.market_id };

  let rowsImported = 0;
  let rowsDuplicate = 0;
  let rowsErrored = 0;
  let rowsSkipped = 0;
  let committedRow = lastRow;
  let stoppedEarly = false;
  const errors: SyncResult["errors"] = [];

  for (const row of rows) {
    if (options.deadlineAt !== undefined && now() + ROW_BUDGET_MS > options.deadlineAt) {
      stoppedEarly = true;
      break;
    }

    // Not an order at all (the merchant deleted it in Converty). Neither
    // imported nor recorded as a failure — but the cursor must still move past
    // it, so it falls through to the commit below.
    if (adapter.skipReason?.(row.data)) {
      rowsSkipped++;
      committedRow = row.rowIndex;
      await deps.setLastRow(config.storefront_id, committedRow);
      continue;
    }

    let failure: string | null = null;

    try {
      const orderData = adapter.mapRow(row.data);
      const result = await deps.processRow({ storefront, orderData, rawRow: row });

      if (result.status === "created") rowsImported++;
      else if (result.status === "duplicate") rowsDuplicate++;
      else failure = result.error ?? "Unknown error";
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    if (failure !== null) {
      rowsErrored++;
      errors.push({ row: row.rowIndex, message: failure });

      // Written down before the cursor moves past it. A row that always fails
      // must not block the queue behind it, but it must not vanish either.
      //
      // Bookkeeping is never allowed to stop the import, though. The first cut
      // of this let the write throw, and because it sits outside the try above,
      // it skipped the cursor commit — one unimportable row would have stalled
      // the sync permanently, which is the exact failure being fixed. It very
      // nearly happened: the table shipped with a partial unique key that made
      // every one of these raise 42P10.
      try {
        await deps.recordFailure?.({
          storefrontId: config.storefront_id,
          rowIndex: row.rowIndex,
          rawRow: row.data as Record<string, unknown>,
          message: failure,
        });
      } catch (err) {
        errors.push({
          row: row.rowIndex,
          message: `could not record failure: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }

    // Per row, so a kill at any point keeps everything before it.
    committedRow = row.rowIndex;
    await deps.setLastRow(config.storefront_id, committedRow);
  }

  return {
    storefront_id: config.storefront_id,
    rows_fetched: rows.length,
    rows_imported: rowsImported,
    rows_duplicate: rowsDuplicate,
    rows_errored: rowsErrored,
    rows_skipped: rowsSkipped,
    last_row: committedRow,
    // Either the window was filled — so there may be more below it — or the
    // clock stopped us with rows in hand.
    has_more: stoppedEarly || rows.length >= (options.maxRows ?? rows.length),
    errors,
  };
}
