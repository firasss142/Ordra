import { google } from "googleapis";
import type { SheetRow, FetchRowsOptions } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

/**
 * How many rows one invocation will look at.
 *
 * Was 500, which was never reachable: the engine's per-row work is measured in
 * hundreds of milliseconds, so 500 rows cannot finish inside the 55s pg_net
 * timeout, and a run that does not finish commits nothing. 50 leaves room to
 * import a normal day's backlog in one pass and to drain a large one over
 * several — the cursor advances every row now, so several passes cost nothing.
 */
const DEFAULT_MAX_ROWS = 50;

/**
 * Google's 400 for a range starting past the sheet's last row.
 *
 * Matched on the message because the API gives no machine-readable reason for
 * it. Narrow on purpose: a 400 for a renamed tab, a revoked credential or a
 * malformed range must still surface as a failed run rather than be mistaken
 * for an empty sheet — silently importing nothing is how the last outage hid.
 */
export function isRangeBeyondSheet(err: unknown): boolean {
  const status = (err as { code?: number; status?: number })?.code
    ?? (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return status === 400 && /exceeds grid limits/i.test(message);
}

function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");

  const credentials = JSON.parse(json) as {
    client_email: string;
    private_key: string;
  };

  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

/**
 * Rows `fromRow`..`fromRow + maxRows - 1`, one-indexed over the *data* rows
 * (so `fromRow: 1` is the first row under the header).
 *
 * This used to request `'sheet'!A1:Z` — the entire sheet, every fifteen
 * minutes — and then throw away everything below the cursor in JavaScript. On
 * the live sheet that is 2,800+ rows fetched to find fifteen, and it was a
 * meaningful share of the 55 seconds that killed every run. Two ranged reads
 * in one batch cost the same as one and are bounded by the window, not by how
 * long the business has been trading.
 */
export async function fetchSheetRows(options: FetchRowsOptions): Promise<SheetRow[]> {
  const { spreadsheetId, sheetName, fromRow, maxRows = DEFAULT_MAX_ROWS } = options;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Spreadsheet row 1 is the header, so data row N lives on spreadsheet row N+1.
  const firstSheetRow = fromRow + 1;

  /**
   * Open-ended on purpose — `A2836:Z`, not `A2836:Z2885`.
   *
   * A bounded upper row is rejected outright once it passes the sheet's grid:
   * against the live sheet, `A900001:Z900050` returns
   * "Range exceeds grid limits. Max rows: 4216". That is not a hypothetical —
   * the cursor climbs toward the grid on every run, and a sheet trimmed to its
   * data extent would make *every* fetch throw the moment the cursor came
   * within `maxRows` of the end. The sync would stall permanently, which is the
   * exact class of failure this rewrite exists to remove.
   *
   * Open-ended costs nothing here: Google truncates at the last row holding
   * data, so the response is bounded by the backlog (nothing, most runs) rather
   * than by the sheet. The 2,800 already-imported rows above the cursor — the
   * ones the old full-sheet read pulled every fifteen minutes — are still never
   * fetched. The window is enforced below, on rows that actually have content.
   */
  let response;
  try {
    response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: [`'${sheetName}'!A1:Z1`, `'${sheetName}'!A${firstSheetRow}:Z`],
    });
  } catch (err) {
    // "Range exceeds grid limits" means the cursor has walked past the last row
    // the sheet even has — there is nothing to import, which is not an error.
    // Google rejects this on the *start* row, so an open-ended range does not
    // save us: `A900001:Z` is refused exactly like `A900001:Z900050`.
    //
    // Reachable in ordinary use. Deleting the trailing blank rows of a sheet —
    // routine tidying — shrinks the grid to the data extent, and the very next
    // run asks for grid + 1. Left to propagate, that is a permanent stall
    // dressed as a failing sync, which is the failure mode this rewrite exists
    // to eliminate. Anything else still throws.
    if (isRangeBeyondSheet(err)) return [];
    throw err;
  }

  const [headerRange, dataRange] = response.data.valueRanges ?? [];

  const headerCells = headerRange?.values?.[0];
  if (!headerCells) return [];
  const headers = (headerCells as unknown[]).map((h) => String(h ?? "").trim());

  const dataRows = (dataRange?.values ?? []) as unknown[][];
  const result: SheetRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    // The window is a budget of rows to *import*, not of rows to look at. A
    // bounded range would have counted blanks against it and — worse — a window
    // landing entirely on blank rows would return nothing, leaving the cursor
    // unmoved and the sync circling that gap forever.
    if (result.length >= maxRows) break;

    // Position in the sheet, not position in the returned array: a blank row in
    // the middle must not shift every row after it onto the wrong index.
    const rowIndex = fromRow + i;

    const cells = dataRows[i] ?? [];
    const data: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        data[headers[j]] = String(cells[j] ?? "").trim();
      }
    }

    // A blank row is skipped but still counted above, so the cursor can move
    // past it rather than stopping on it forever.
    const hasContent = Object.values(data).some((v) => v !== "");
    if (!hasContent) continue;

    result.push({ rowIndex, data });
  }

  return result;
}
