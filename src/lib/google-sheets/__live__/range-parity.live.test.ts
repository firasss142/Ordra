// @vitest-environment node
//
// The suite default is jsdom, whose URLSearchParams is not Node's, and
// google-auth-library's token request fails the `instanceof` check against it.
// The sync itself only ever runs server-side, so node is also the honest
// environment to prove it in.
/**
 * Live parity check against the real spreadsheet. NOT part of the normal suite —
 * it talks to Google. Run explicitly:
 *
 *   npx vitest run src/lib/google-sheets/__live__ --testTimeout=60000
 *
 * WHY THIS EXISTS: the sync rewrite replaced a full-sheet read
 * (`'sheet'!A1:Z`, filtered in JavaScript) with two ranged reads and a computed
 * row index. An off-by-one in that arithmetic does not fail loudly — it either
 * skips orders forever or re-imports them as duplicates. No unit test can prove
 * the mapping is right, because the thing being asserted is what Google returns
 * for a given A1 range. So this asks the real sheet both ways and diffs them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { google } from "googleapis";
import { fetchSheetRows } from "../client";
import type { SheetRow } from "../types";

const SPREADSHEET_ID = "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8";
const SHEET_NAME = "converty-orders-bachir";
/** Where the production cursor has been frozen since 2026-08-08. */
const PROD_CURSOR = 2834;

function loadEnv() {
  const raw = readFileSync(`${process.cwd()}/.env.local`, "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

/** The pre-rewrite implementation, verbatim, for comparison. */
async function fetchRowsTheOldWay(fromRow: number): Promise<SheetRow[]> {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:Z`,
  });

  const values = response.data.values;
  if (!values || values.length < 2) return [];

  const headers = (values[0] as unknown[]).map((h) => String(h ?? "").trim());
  const dataRows = values.slice(1);

  const result: SheetRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const rowIndex = i + 1;
    if (rowIndex < fromRow) continue;

    const cells = dataRows[i] as unknown[];
    const data: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) data[headers[j]] = String(cells[j] ?? "").trim();
    }
    const hasContent = Object.values(data).some((v) => v !== "");
    if (!hasContent) continue;

    result.push({ rowIndex, data });
  }
  return result;
}

describe("live: ranged fetch matches the full-sheet fetch it replaces", () => {
  let oldRows: SheetRow[];

  beforeAll(async () => {
    loadEnv();
    oldRows = await fetchRowsTheOldWay(PROD_CURSOR + 1);
    // eslint-disable-next-line no-console
    console.log(
      `[live] sheet has ${oldRows.length} unimported rows past the frozen cursor ${PROD_CURSOR}`,
    );
  }, 60_000);

  it("returns the same rows, under the same indices, as the old full-sheet read", async () => {
    // The assertion that matters: index N must mean the same physical row in
    // both implementations. If it does not, every future import is off by one.
    const newRows = await fetchSheetRows({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      fromRow: PROD_CURSOR + 1,
      maxRows: 50,
    });

    const expected = oldRows.slice(0, newRows.length);
    expect(newRows.map((r) => r.rowIndex)).toEqual(expected.map((r) => r.rowIndex));

    for (let i = 0; i < newRows.length; i++) {
      expect(newRows[i].data, `row ${newRows[i].rowIndex} differs`).toEqual(expected[i].data);
    }
  }, 60_000);

  it("reads the same physical row when asked for a single row deep in the sheet", async () => {
    // A window of one is where an off-by-one is unmissable.
    const probe = oldRows[0]?.rowIndex ?? PROD_CURSOR + 1;
    const one = await fetchSheetRows({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      fromRow: probe,
      maxRows: 1,
    });

    expect(one).toHaveLength(1);
    expect(one[0].rowIndex).toBe(probe);
    expect(one[0].data).toEqual(oldRows[0].data);
  }, 60_000);

  it("does not overshoot its window", async () => {
    const five = await fetchSheetRows({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      fromRow: PROD_CURSOR + 1,
      maxRows: 5,
    });
    expect(five.length).toBeLessThanOrEqual(5);
    // Every returned index must sit inside the requested window.
    for (const r of five) {
      expect(r.rowIndex).toBeGreaterThanOrEqual(PROD_CURSOR + 1);
      expect(r.rowIndex).toBeLessThanOrEqual(PROD_CURSOR + 5);
    }
  }, 60_000);

  it("returns nothing, and does not throw, past the end of the sheet", async () => {
    const beyond = await fetchSheetRows({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      fromRow: 900_000,
      maxRows: 50,
    });
    expect(beyond).toEqual([]);
  }, 60_000);
});
