// @vitest-environment node
/**
 * READ-ONLY. Answers one question: of the sheet rows still ahead of the cursor,
 * how many are orders the system does not already have?
 *
 *   npx vitest run src/lib/google-sheets/__live__/pending.live.test.ts --testTimeout=180000
 *
 * WHY: the first runs after the fix reported `imported: 0, duplicate: 48`,
 * which reads like the sync is doing nothing. It is not — those rows were
 * already in the system. The old engine committed its cursor only at the end of
 * a batch, but each order insert committed on its own, so every run re-imported
 * from the same frozen cursor: the early rows landed on the first pass and
 * every pass since has re-read them as duplicates. The genuinely new orders sit
 * at the far end of the backlog, which is what this counts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

const SPREADSHEET_ID = "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8";
const SHEET_NAME = "converty-orders-bachir";

beforeAll(() => {
  const raw = readFileSync(`${process.cwd()}/.env.local`, "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
});

describe("live: what is actually still missing", () => {
  it("counts the pending rows the system does not already hold", async () => {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { fetchSheetRows } = await import("../client");

    const admin = createAdminClient();

    const { data: stateRow } = await admin
      .from("settings")
      .select("value")
      .eq("key", "google_sheets_sync_state")
      .maybeSingle();
    const cursor =
      (stateRow?.value as Record<string, { last_row: number }> | null)?.[
        "fb25c439-b3b0-4087-a4db-2ca616e78c74"
      ]?.last_row ?? 0;

    // Everything from the cursor to the end of the sheet.
    const rows = await fetchSheetRows({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      fromRow: cursor + 1,
      maxRows: 5000,
    });

    const ids = rows.map((r) => r.data["QR Code"]).filter(Boolean);
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin
        .from("orders")
        .select("external_id")
        .in("external_id", ids.slice(i, i + 200));
      for (const o of data ?? []) known.add((o as { external_id: string }).external_id);
    }

    const missing = rows.filter((r) => !known.has(r.data["QR Code"]));
    const newest = rows[rows.length - 1]?.data;

    // The split that actually answers "how many orders will appear": the
    // adapter rejects any row with a blank Name, so those never become orders
    // however many times the sync reads them.
    const importable = missing.filter((r) => (r.data["Name"] ?? "").trim() !== "");
    const blockedOnName = missing.length - importable.length;

    // eslint-disable-next-line no-console
    console.log(
      `[pending] cursor=${cursor} rows_ahead=${rows.length} ` +
        `already_in_system=${known.size} GENUINELY_NEW=${missing.length} ` +
        `-> WILL_IMPORT=${importable.length} blocked_on_blank_name=${blockedOnName}`,
    );
    for (const r of importable.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log(
        `[pending]   WILL IMPORT row ${r.rowIndex} ref=${r.data["Reference"]} ` +
          `name="${r.data["Name"]}" created=${r.data["Created At"]}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(`[pending] newest sheet row is dated ${newest?.["Created At"] ?? "?"}`);
    for (const m of missing.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log(
        `[pending]   row ${m.rowIndex} ref=${m.data["Reference"]} ` +
          `name="${m.data["Name"]}" created=${m.data["Created At"]}`,
      );
    }

    expect(rows.length).toBeGreaterThanOrEqual(0);
  }, 180_000);
});
