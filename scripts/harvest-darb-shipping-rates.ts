/**
 * Harvest Darb Assabil per-destination shipping prices into darb_shipping_rates.
 *
 * WHY: Libyan carriers price by destination address, not a flat rate. Both Darb
 * accounts carry an identical flat carriers.delivery_fee, so the OMS could not
 * tell which account is cheaper for a given customer. This fills the table the
 * recommendation reads. See plans/darb-per-destination-rate-recommendation.md.
 *
 * Calls ONLY POST /api/local/shipments/calculate/shipping — the vendor's PREVIEW
 * endpoint. It never creates a shipment.
 *
 * 278 catalogue (city, area) combos x 2 accounts = 556 cells. Measured p95 171ms
 * with no throttling at 300ms spacing, so a full sweep runs in about two minutes.
 *
 * Usage (loads app env for Supabase + ENCRYPTION_KEY):
 *   npx tsx --env-file=.env.local scripts/harvest-darb-shipping-rates.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/harvest-darb-shipping-rates.ts --apply
 *   npx tsx --env-file=.env.local scripts/harvest-darb-shipping-rates.ts --apply --limit=20
 *   npx tsx --env-file=.env.local scripts/harvest-darb-shipping-rates.ts --apply --city=بنغازي
 *   npx tsx --env-file=.env.local scripts/harvest-darb-shipping-rates.ts --apply --carrier=benghazi
 */
import { createClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "../src/lib/carriers/dispatch";
import { DARB_ASSABIL_CITIES } from "../src/lib/carriers/darb-assabil-areas";
import {
  fetchDarbQuote,
  HARVEST_QUOTE_AMOUNT,
} from "../src/lib/carriers/darb-rate-quote";
import {
  buildHarvestPlan,
  runHarvest,
  type DarbRateUpsertRow,
  type HarvestCarrier,
} from "../src/lib/carriers/darb-rate-harvest";
import type { CarrierConfig } from "../src/lib/carriers/types";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
};
const APPLY = flag("apply") !== undefined;
const LIMIT = flag("limit") ? Number(flag("limit")) : undefined;
const CITY = flag("city");
const CARRIER = (flag("carrier") ?? "both").toLowerCase();
const DELAY_MS = Number(flag("delay-ms") ?? 250);

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const admin = createClient(
  env("NEXT_PUBLIC_SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface Account extends HarvestCarrier {
  label: string;
  config: CarrierConfig;
}

async function loadAccount(carrierId: string, fallbackServiceId: string): Promise<Account> {
  // Resolve by ID — .eq("code", …).single() would throw, two rows share the code.
  const { data, error } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("id", carrierId)
    .single();
  if (error || !data) throw new Error(`carrier ${carrierId} fetch failed: ${error?.message}`);

  const row: CarrierRow = {
    id: data.id,
    code: data.code,
    api_endpoint: data.api_endpoint,
    api_credentials: data.api_credentials,
    delivery_fee: Number(data.delivery_fee),
    return_fee: Number(data.return_fee),
  };
  const config = buildConfig(row);
  const credDefault = config.apiCredentials.default_service_id ?? "";
  if (!credDefault) {
    console.warn(
      `  WARN ${data.name}: no default_service_id in credentials — using the catalogue default.`,
    );
  }
  return {
    carrierId: data.id,
    label: data.name as string,
    config,
    serviceId: credDefault || fallbackServiceId,
  };
}

async function catalogueDefaultServiceId(): Promise<string> {
  const { data, error } = await admin
    .from("darb_services")
    .select("service_id, is_default")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`darb_services fetch failed: ${error.message}`);
  const rows = data ?? [];
  const id = (rows.find((r) => r.is_default)?.service_id as string) ?? (rows[0]?.service_id as string);
  if (!id) throw new Error("darb_services is empty — nothing to quote with");
  return id;
}

async function main() {
  const destinations = Object.entries(DARB_ASSABIL_CITIES)
    .filter(([city]) => !CITY || city === CITY)
    .flatMap(([city, areas]) => areas.map((area) => ({ city, area })));

  if (destinations.length === 0) {
    throw new Error(`No destinations matched${CITY ? ` --city=${CITY}` : ""}`);
  }

  const fallbackServiceId = await catalogueDefaultServiceId();
  const wanted =
    CARRIER === "tripoli" ? [TRIPOLI] : CARRIER === "benghazi" ? [BENGHAZI] : [TRIPOLI, BENGHAZI];

  const accounts: Account[] = [];
  for (const id of wanted) accounts.push(await loadAccount(id, fallbackServiceId));

  const cells = buildHarvestPlan({ carriers: accounts, destinations });
  const planned = LIMIT != null ? Math.min(LIMIT, cells.length) : cells.length;

  console.log("Darb Assabil rate harvest");
  console.log(`  accounts     : ${accounts.map((a) => a.label).join(", ")}`);
  console.log(`  destinations : ${destinations.length}${CITY ? ` (city=${CITY})` : ""}`);
  console.log(`  cells        : ${planned}${LIMIT != null ? ` of ${cells.length}` : ""}`);
  console.log(`  quote amount : ${HARVEST_QUOTE_AMOUNT} lyd`);
  console.log(`  spacing      : ${DELAY_MS}ms  (~${Math.round((planned * DELAY_MS) / 1000)}s)`);
  console.log(`  MODE         : ${APPLY ? "APPLY" : "dry run (no calls, no writes)"}`);

  if (!APPLY) {
    console.log("\nPass --apply to run it.");
    return;
  }

  const { data: run, error: runError } = await admin
    .from("darb_rate_harvest_runs")
    .insert({ trigger: "script", requested: planned })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`could not open a harvest run: ${runError?.message}`);
  const runId = run.id as string;
  console.log(`  run id       : ${runId}\n`);

  const configByCarrier = new Map(accounts.map((a) => [a.carrierId, a.config]));
  let done = 0;

  const summary = await runHarvest({
    cells,
    limit: LIMIT,
    delayMs: DELAY_MS,
    runId,
    now: () => new Date(),
    sleep,
    quote: async (cell) => {
      const config = configByCarrier.get(cell.carrierId);
      if (!config) throw new Error(`no config for carrier ${cell.carrierId}`);
      const result = await fetchDarbQuote(config, {
        serviceId: cell.serviceId,
        city: cell.city,
        area: cell.area,
        amount: HARVEST_QUOTE_AMOUNT,
      });
      done += 1;
      if (done % 50 === 0) console.log(`  … ${done}/${planned}`);
      return result;
    },
    upsert: async (rows: DarbRateUpsertRow[]) => {
      const { error } = await admin.rpc("upsert_darb_shipping_rates", { p_rows: rows });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    },
  });

  await admin
    .from("darb_rate_harvest_runs")
    .update({
      finished_at: new Date().toISOString(),
      requested: summary.requested,
      succeeded: summary.succeeded,
      failed: summary.failed,
      status: summary.status,
      notes: summary.circuitOpened
        ? `circuit opened after consecutive failures; ${summary.skipped} cells skipped`
        : null,
    })
    .eq("id", runId);

  console.log(
    `\nDone: ${summary.succeeded} ok, ${summary.failed} failed, ${summary.skipped} skipped — ${summary.status}`,
  );
  if (summary.circuitOpened) {
    console.error("  CIRCUIT OPENED — an account is failing systematically. Check credentials.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
