// @vitest-environment node
/**
 * Dry run of the real backlog through the real adapter. READ-ONLY — it maps
 * every pending sheet row but never writes an order.
 *
 *   npx vitest run src/lib/google-sheets/__live__/dry-run.live.test.ts --testTimeout=120000
 *
 * WHY: after the timeout fix, the next cron run will pull this backlog and try
 * to import it. Row mapping is where a sheet row most often fails — a renamed
 * column, a blank phone, a product string the adapter cannot parse — and
 * finding that out from production is finding it out from missing orders. This
 * runs the same `syncOneStorefront` the cron runs, with the write swapped for a
 * counter, so a mapping problem surfaces here instead.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fetchSheetRows } from "../client";
import { syncOneStorefront, type SheetSyncConfig } from "../sync-engine";

const CONFIG: SheetSyncConfig = {
  storefront_id: "fb25c439-b3b0-4087-a4db-2ca616e78c74",
  spreadsheet_id: "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8",
  sheet_name: "converty-orders-bachir",
  platform: "converty",
  is_active: true,
  market_id: "ly",
};

const PROD_CURSOR = 2834;

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

describe("live dry run: the pending backlog", () => {
  it("maps every pending row without a single mapping failure", async () => {
    let cursor = PROD_CURSOR;
    const committed: number[] = [];
    let mapped = 0;
    const failures: Array<{ row: number; message: string; raw?: string }> = [];

    // Walk the backlog exactly as the cron will: 50 at a time, cursor advancing.
    for (let pass = 0; pass < 20; pass++) {
      const result = await syncOneStorefront(
        CONFIG,
        {
          fetchRows: (opts) => fetchSheetRows(opts),
          // The only substitution: count instead of insert.
          processRow: async () => {
            mapped++;
            return { status: "created", orderId: `dry-${mapped}` };
          },
          getLastRow: async () => cursor,
          setLastRow: async (_id, lastRow) => {
            cursor = lastRow;
            committed.push(lastRow);
          },
          recordFailure: async (f) => {
            failures.push({
              row: f.rowIndex,
              message: f.message,
              raw: JSON.stringify(
                Object.fromEntries(
                  Object.entries(f.rawRow).filter(([, v]) => v !== "" && v != null),
                ),
              ).slice(0, 400),
            });
          },
        },
        { maxRows: 50 },
      );

      if (result.rows_fetched === 0) break;
      if (!result.has_more) break;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] mapped ${mapped} rows, ${failures.length} failed, cursor ${PROD_CURSOR} -> ${cursor}`,
    );
    for (const f of failures.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run]   row ${f.row}: ${f.message} :: ${f.raw ?? ""}`);
    }

    expect(mapped).toBeGreaterThan(0);

    /**
     * The backlog is not required to be clean — it is required to fail only for
     * reasons that are about the data, never about the mapping.
     *
     * As measured: 352 of 383 rows map, and every rejection is a row whose
     * `Name` column is genuinely blank. That is the adapter's pre-existing rule
     * (converty-sheets-adapter.ts), not a regression — the old sync rejected
     * these too, it just stepped over them in silence. Any OTHER message here
     * means the mapping is broken and orders would be lost on deploy.
     */
    const unexpected = failures.filter((f) => !/Missing customer name/.test(f.message));
    expect(unexpected).toEqual([]);

    // And every one of those really is a blank name, not a column we misread.
    for (const f of failures) {
      expect(f.raw, `row ${f.row} claims a missing name but carries one`).not.toMatch(
        /"Name":"[^"]+"/,
      );
    }
  }, 180_000);

  it("advances the cursor strictly forward, one commit per row", async () => {
    // A cursor that ever moves backwards re-imports orders as duplicates.
    let cursor = PROD_CURSOR;
    const committed: number[] = [];

    await syncOneStorefront(
      CONFIG,
      {
        fetchRows: (opts) => fetchSheetRows(opts),
        processRow: async () => ({ status: "created", orderId: "dry" }),
        getLastRow: async () => cursor,
        setLastRow: async (_id, lastRow) => {
          cursor = lastRow;
          committed.push(lastRow);
        },
      },
      { maxRows: 25 },
    );

    expect(committed.length).toBeGreaterThan(0);
    for (let i = 1; i < committed.length; i++) {
      expect(committed[i]).toBeGreaterThan(committed[i - 1]);
    }
    expect(committed[0]).toBeGreaterThan(PROD_CURSOR);
  }, 120_000);
});
