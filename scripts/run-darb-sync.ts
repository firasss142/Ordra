/**
 * Run the Darb Assabil sync sweep from the command line.
 *
 * Same engine the cron drives (runDarbSyncForAllAccounts), so what you see here
 * is exactly what the schedule will do. Use it to seed the mirror for the first
 * time, to reconcile after an outage, or to inspect a sweep before trusting it.
 *
 *   --dry-run   fetch and project everything, write NOTHING. Prints what would
 *               change, including per-order status promotions.
 *   --since=ISO delta sweep; stops at the first page with nothing newer.
 *   --account=tripoli|benghazi|both
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-darb-sync.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/run-darb-sync.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import {
  runDarbSyncCycle,
  buildDarbSyncDeps,
  DARB_PAGE_SIZE,
  type DarbSyncDeps,
} from "../src/lib/carriers/darb-sync-cycle";
import { runDarbSyncForAllAccounts } from "../src/app/api/cron/darb-sync/handler";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const DRY_RUN = flag("dry-run") !== undefined;
const SINCE = flag("since") || null;
const ACCOUNT = (flag("account") ?? "both").toLowerCase();

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin: SupabaseClient = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

async function main() {
  console.log(`Darb Assabil sync — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  if (SINCE) console.log(`  delta since: ${SINCE}`);

  const { data, error } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => {
    if (ACCOUNT === "both") return true;
    return String(r.name).toLowerCase().includes(ACCOUNT);
  });
  console.log(`  accounts: ${rows.map((r) => r.name).join(", ")}\n`);

  if (!DRY_RUN) {
    const results = await runDarbSyncForAllAccounts(admin, SINCE, "manual");
    for (const r of results) {
      const name = rows.find((x) => x.id === r.carrierId)?.name ?? r.carrierId;
      console.log(
        `  ${pad(String(name), 26)} ${pad(r.status, 10)} pages=${r.pagesFetched} seen=${r.shipmentsSeen} ` +
          `upserted=${r.shipmentsUpserted} events=${r.eventsInserted} comments=${r.commentsInserted} matched=${r.ordersMatched} promoted=${r.ordersPromoted}` +
          (r.errorMessage ? `\n      error: ${r.errorMessage}` : ""),
      );
    }
    return;
  }

  // ── Dry run: real fetch + real projection, stubbed writes ────────────
  for (const row of rows) {
    const config = buildConfig(row as unknown as CarrierRow);
    const real = buildDarbSyncDeps(admin, new Map([[row.id, config]]), "manual");

    const wouldUpsert: Array<Record<string, unknown>> = [];
    const wouldEvents: Array<Record<string, unknown>> = [];
    const wouldComments: Array<Record<string, unknown>> = [];
    const wouldPromote: Array<{ orderId: string; slug: string | null; reference: string | null }> = [];
    const wouldLog: string[] = [];

    const deps: DarbSyncDeps = {
      fetchPage: real.fetchPage,
      loadOrderIndex: real.loadOrderIndex,
      upsertShipments: async (r) => {
        wouldUpsert.push(...r);
        return r.length;
      },
      insertTimelineEvents: async (r) => {
        wouldEvents.push(...r);
        return r.length;
      },
      insertConversation: async (r) => {
        wouldComments.push(...r);
        return r.length;
      },
      promoteStatus: async (i) => {
        wouldPromote.push(i);
        return { promoted: false };
      },
      writeLog: async (e) => {
        wouldLog.push(`${e.outcome_reason}`);
      },
    };

    const result = await runDarbSyncCycle(deps, {
      carrierId: row.id,
      pageSize: DARB_PAGE_SIZE,
      since: SINCE,
      source: "manual",
    });

    console.log(`  ${row.name}`);
    console.log(
      `    status=${result.status} pages=${result.pagesFetched} shipments=${result.shipmentsSeen} ` +
        `matched=${result.ordersMatched} unmatched=${result.shipmentsSeen - result.ordersMatched}`,
    );
    console.log(
      `    would upsert ${wouldUpsert.length} shipment rows, ${wouldEvents.length} timeline events, ${wouldComments.length} comments`,
    );
    console.log(`    would promote ${wouldPromote.length} orders`);
    if (result.errorMessage) console.log(`    error: ${result.errorMessage}`);

    const bySlug = new Map<string, number>();
    for (const s of wouldUpsert) {
      const k = String(s.status_slug ?? "(null)");
      bySlug.set(k, (bySlug.get(k) ?? 0) + 1);
    }
    console.log(
      `    carrier statuses: ${[...bySlug.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    );

    const withHandler = wouldUpsert.filter((s) => s.handler_name).length;
    const withRemark = wouldUpsert.filter((s) => s.latest_remark).length;
    const withCause = wouldUpsert.filter((s) => s.cancellation_cause).length;
    const withComment = wouldUpsert.filter((s) => s.latest_comment).length;
    const withBilled = wouldUpsert.filter((s) => s.billed_shipping_amount != null).length;
    const withWithdrawal = wouldUpsert.filter((s) => s.delivery_withdrawal_at).length;
    console.log(
      `    NEW DATA captured: driver=${withHandler} remarks=${withRemark} comments=${withComment} cancel_reason=${withCause} ` +
        `billed_fee=${withBilled} cod_settled=${withWithdrawal}`,
    );

    const billed = wouldUpsert
      .map((s) => Number(s.billed_shipping_amount))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (billed.length) {
      const sum = billed.reduce((a, b) => a + b, 0);
      console.log(
        `    billed shipping: n=${billed.length} avg=${(sum / billed.length).toFixed(2)} LYD ` +
          `min=${Math.min(...billed)} max=${Math.max(...billed)}  (carriers.delivery_fee assumes ${row.delivery_fee})`,
      );
    }
    if (wouldLog.length) {
      console.log(`    unknown statuses: ${[...new Set(wouldLog)].join(", ")}`);
    }
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
