import type { SheetRow, FetchRowsOptions } from "./types";
import type { CreateOrderResult } from "@/lib/orders/create-order-from-data";
import { getSheetsAdapter } from "@/lib/storefronts/sheets/adapter-registry";
import { PayloadMappingError } from "@/lib/storefronts/errors";

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
  last_row: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ProcessRowParams {
  storefront: { id: string; market_id: string };
  orderData: ReturnType<ReturnType<typeof getSheetsAdapter>["mapRow"]>;
  rawRow: SheetRow;
}

export interface SyncEngineDeps {
  fetchRows: (opts: FetchRowsOptions) => Promise<SheetRow[]>;
  processRow: (params: ProcessRowParams) => Promise<CreateOrderResult>;
  getLastRow: (storefrontId: string) => Promise<number>;
  setLastRow: (storefrontId: string, lastRow: number) => Promise<void>;
}

export async function syncOneStorefront(
  config: SheetSyncConfig,
  deps: SyncEngineDeps
): Promise<SyncResult> {
  const empty: SyncResult = {
    storefront_id: config.storefront_id,
    rows_fetched: 0,
    rows_imported: 0,
    rows_duplicate: 0,
    rows_errored: 0,
    last_row: 0,
    errors: [],
  };

  if (!config.is_active) return empty;

  const lastRow = await deps.getLastRow(config.storefront_id);
  const rows = await deps.fetchRows({
    spreadsheetId: config.spreadsheet_id,
    sheetName: config.sheet_name,
    fromRow: lastRow + 1,
  });

  if (rows.length === 0) return empty;

  const adapter = getSheetsAdapter(config.platform);
  const storefront = { id: config.storefront_id, market_id: config.market_id };

  let rowsImported = 0;
  let rowsDuplicate = 0;
  let rowsErrored = 0;
  let highestRow = lastRow;
  const errors: SyncResult["errors"] = [];

  for (const row of rows) {
    highestRow = row.rowIndex;

    let orderData;
    try {
      orderData = adapter.mapRow(row.data);
    } catch (err) {
      rowsErrored++;
      errors.push({
        row: row.rowIndex,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const result = await deps.processRow({ storefront, orderData, rawRow: row });

    if (result.status === "created") {
      rowsImported++;
    } else if (result.status === "duplicate") {
      rowsDuplicate++;
    } else {
      rowsErrored++;
      errors.push({
        row: row.rowIndex,
        message: result.error ?? "Unknown error",
      });
    }
  }

  await deps.setLastRow(config.storefront_id, highestRow);

  return {
    storefront_id: config.storefront_id,
    rows_fetched: rows.length,
    rows_imported: rowsImported,
    rows_duplicate: rowsDuplicate,
    rows_errored: rowsErrored,
    last_row: highestRow,
    errors,
  };
}
