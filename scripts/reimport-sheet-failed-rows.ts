/**
 * Re-import Google Sheets rows that the sync rejected and recorded in
 * `sheet_sync_failed_rows`, under the CURRENT adapter rules.
 *
 * WHY: until 2026-09-05 the Converty adapter threw on a blank Name, so every
 * such checkout (a real lead, phone present) was written down as a failure and
 * never became an order. The rule changed — blank Name now imports with a
 * placeholder — but the cursor is already past those rows, so the cron will
 * never see them again. This script walks the failure table instead.
 *
 * What it does per open failure (resolved_at IS NULL):
 *   1. Re-reads the live sheet row at the recorded row_index and uses it if
 *      its QR Code matches the stored raw_row (the merchant may have filled the
 *      name in since); otherwise falls back to the stored raw_row.
 *   2. Runs the SAME adapter + createOrderFromData the cron uses — same product
 *      resolution, city resolution, auto-assign, order_history note.
 *   3. Back-dates orders.created_at to the sheet's `Created At` (market local
 *      time → UTC), so a Sep 1 checkout lands on Sep 1 in every daily figure,
 *      not on the day this script happened to run. The order_history row keeps
 *      the true import time, so nothing is hidden.
 *   4. Marks the failure resolved. A row that fails again keeps its record and
 *      gets the new reason.
 *
 * Rows the adapter now says to skip (Converty `deleted`) are resolved without
 * an order. Rows still failing for another reason are left open and listed.
 *
 * Dry run by default. Scope with --since=YYYY-MM-DD (sheet `Created At`, local).
 *
 *   npx tsx --env-file=.env.local scripts/reimport-sheet-failed-rows.ts --since=2026-09-01
 *   npx tsx --env-file=.env.local scripts/reimport-sheet-failed-rows.ts --since=2026-09-01 --apply
 */
import { createClient } from "@supabase/supabase-js";
import { fetchSheetRows } from "../src/lib/google-sheets/client";
import { getSheetsSources } from "../src/lib/google-sheets/sources-config";
import { getSheetsAdapter } from "../src/lib/storefronts/sheets/adapter-registry";
import { createOrderFromData } from "../src/lib/orders/create-order-from-data";
import { marketTimezone } from "../src/lib/markets";
import { localDateTimeToUtcIso } from "../src/lib/dates/market-day";

const APPLY = process.argv.includes("--apply");
const sinceArg = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
if (!sinceArg || !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) {
  console.error("--since=YYYY-MM-DD is required (sheet 'Created At', market local time)");
  process.exit(1);
}
const SINCE = sinceArg;

type FailedRow = {
  id: string;
  market_id: string;
  storefront_id: string;
  row_index: number;
  raw_row: Record<string, string>;
  message: string;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing");
  const db = createClient(url, key);

  const { data, error } = await db
    .from("sheet_sync_failed_rows")
    .select("id, market_id, storefront_id, row_index, raw_row, message")
    .is("resolved_at", null)
    .order("row_index", { ascending: true });
  if (error) throw error;

  const open = ((data ?? []) as FailedRow[]).filter(
    (f) => (f.raw_row?.["Created At"] ?? "") >= SINCE
  );
  console.log(`Open failures with Created At >= ${SINCE}: ${open.length}`);
  if (open.length === 0) return;

  // Group by (market, storefront) so each source is read from its own sheet.
  const byStorefront = new Map<string, FailedRow[]>();
  for (const f of open) {
    const k = `${f.market_id}|${f.storefront_id}`;
    byStorefront.set(k, [...(byStorefront.get(k) ?? []), f]);
  }

  let created = 0, duplicate = 0, skipped = 0, stillFailing = 0;

  for (const [k, failures] of byStorefront) {
    const [marketId, storefrontId] = k.split("|");
    const source = (await getSheetsSources(db, marketId)).find(
      (s) => s.storefront_id === storefrontId
    );
    if (!source) {
      console.error(`  ✗ no sheet source configured for storefront ${storefrontId}; skipping ${failures.length}`);
      stillFailing += failures.length;
      continue;
    }
    const adapter = getSheetsAdapter(source.platform);
    const tz = marketTimezone(marketId);

    // One ranged read covering every failed row for this sheet, fresh.
    const lo = Math.min(...failures.map((f) => f.row_index));
    const hi = Math.max(...failures.map((f) => f.row_index));
    const fresh = new Map(
      (
        await fetchSheetRows({
          spreadsheetId: source.spreadsheet_id,
          sheetName: source.sheet_name,
          fromRow: lo,
          maxRows: hi - lo + 1,
        })
      ).map((r) => [r.rowIndex, r.data])
    );

    for (const f of failures) {
      const live = fresh.get(f.row_index);
      const sameRow = live && live["QR Code"]?.trim() === f.raw_row["QR Code"]?.trim();
      const row = sameRow ? live! : f.raw_row;
      const src = sameRow ? "live" : "stored";
      const label = `row ${f.row_index} qr=${row["QR Code"]} name="${row["Name"] ?? ""}" phone=${row["Phone"]} created=${row["Created At"]}`;

      const skip = adapter.skipReason?.(row);
      if (skip) {
        skipped++;
        console.log(`  – SKIP  ${label} → ${skip}`);
        if (APPLY) await db.from("sheet_sync_failed_rows").update({ resolved_at: new Date().toISOString(), message: `resolved: ${skip}` }).eq("id", f.id);
        continue;
      }

      let orderData;
      try {
        orderData = adapter.mapRow(row);
      } catch (err) {
        stillFailing++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ STILL FAILS ${label} → ${msg}`);
        if (APPLY) await db.from("sheet_sync_failed_rows").update({ message: msg.slice(0, 2000) }).eq("id", f.id);
        continue;
      }

      const backdatedTo = localDateTimeToUtcIso(row["Created At"] ?? "", tz);
      if (!APPLY) {
        console.log(`  ✓ WOULD IMPORT (${src}) ${label} → created_at ${backdatedTo ?? "(now — unparsable Created At)"}`);
        created++;
        continue;
      }

      const result = await createOrderFromData({
        adminClient: db,
        storefront: { id: storefrontId, market_id: marketId },
        orderData,
        rawPayload: row,
        sourceNote: `Order re-imported from Google Sheets failed rows (sheet row ${f.row_index}; original rejection: ${f.message})`,
      });

      if (result.status === "created") {
        created++;
        if (backdatedTo && result.orderId) {
          await db.from("orders").update({ created_at: backdatedTo }).eq("id", result.orderId);
        }
        await db.from("sheet_sync_failed_rows").update({ resolved_at: new Date().toISOString(), message: `resolved: imported as order ${result.orderId}` }).eq("id", f.id);
        console.log(`  ✓ IMPORTED (${src}) ${label} → ${result.orderId} @ ${backdatedTo ?? "now"}`);
      } else if (result.status === "duplicate") {
        duplicate++;
        await db.from("sheet_sync_failed_rows").update({ resolved_at: new Date().toISOString(), message: `resolved: already imported as order ${result.orderId}` }).eq("id", f.id);
        console.log(`  = DUPLICATE ${label} → ${result.orderId}`);
      } else {
        stillFailing++;
        await db.from("sheet_sync_failed_rows").update({ message: (result.error ?? "unknown error").slice(0, 2000) }).eq("id", f.id);
        console.log(`  ✗ STILL FAILS ${label} → ${result.error}`);
      }
    }
  }

  console.log(
    `\n${APPLY ? "APPLIED" : "DRY RUN"} — imported ${created}, duplicate ${duplicate}, skipped ${skipped}, still failing ${stillFailing}${APPLY ? "" : ". Re-run with --apply."}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
