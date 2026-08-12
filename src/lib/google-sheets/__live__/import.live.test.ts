// @vitest-environment node
/**
 * THIS ONE WRITES. It runs the real sync against production and imports real
 * orders — the same `runSyncForMarket` the cron calls, no substitutions.
 *
 *   BATCH=5 npx vitest run src/lib/google-sheets/__live__/import.live.test.ts --testTimeout=300000
 *
 * WHY IT EXISTS: the fix is committed but not deployed, so production is still
 * running the version that loses every batch. This drains the backlog from a
 * developer machine using the fixed code, so orders reach the orders page
 * without waiting on a deploy.
 *
 * Safe to re-run and safe to interrupt. The cursor commits per row, so a run
 * that is killed halfway keeps exactly what it finished, and
 * `createOrderFromData` rejects an order whose external id already exists —
 * re-running imports the next rows, never the same ones twice.
 *
 * BATCH controls how many rows to take. Start small, check the result, widen.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

const LIBYA = "00000000-0000-0000-0000-000000000002";

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

describe("live import: drain the backlog into production", () => {
  it("imports a batch and reports exactly what it did", async () => {
    const batch = Number(process.env.BATCH ?? 5);

    // Imported here, after the env is loaded — the Supabase admin client reads
    // its keys at module load.
    const { createAdminClient } = await import("@/lib/supabase/server");
    const { runSyncForMarket } = await import("../run-sync");

    const admin = createAdminClient();

    const before = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("market_id", LIBYA);

    const results = await runSyncForMarket(admin, LIBYA, {
      trigger: "manual",
      maxRowsPerSource: batch,
      // Generous: this is not running under pg_net's 55s ceiling.
      deadlineAt: Date.now() + 280_000,
    });

    const after = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("market_id", LIBYA);

    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `[import] fetched=${r.rows_fetched} imported=${r.rows_imported} ` +
          `duplicate=${r.rows_duplicate} errored=${r.rows_errored} ` +
          `cursor->${r.last_row} more=${r.has_more}`,
      );
      for (const e of r.errors.slice(0, 5)) {
        // eslint-disable-next-line no-console
        console.log(`[import]   row ${e.row}: ${e.message}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[import] orders in Libya: ${before.count} -> ${after.count}`);

    expect(results.length).toBeGreaterThan(0);
    // Whatever else happened, the run must have reached a terminal state and
    // released its lock — a run left 'running' blocks every later one.
    const { data: stuck } = await admin
      .from("sheet_sync_runs")
      .select("id")
      .eq("status", "running");
    expect(stuck ?? []).toEqual([]);
  }, 300_000);
});
