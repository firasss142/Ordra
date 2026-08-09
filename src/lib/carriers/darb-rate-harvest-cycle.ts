import type { SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "./dispatch";
import { DARB_ASSABIL_CITIES } from "./darb-assabil-areas";
import { fetchDarbQuote, HARVEST_QUOTE_AMOUNT } from "./darb-rate-quote";
import {
  buildHarvestPlan,
  cellKey,
  orderCellsByStaleness,
  runHarvest,
  type DarbRateUpsertRow,
  type HarvestRunSummary,
} from "./darb-rate-harvest";
import type { CarrierConfig } from "./types";

/**
 * Production wiring for the rate harvest: resolve the Darb accounts, order the
 * plan stalest-first, quote, upsert, and record the run. Shared by the nightly
 * cron route and scripts/harvest-darb-shipping-rates.ts.
 *
 * All the interesting rules live in darb-rate-harvest.ts and are unit-tested
 * there. This file is deliberately thin glue.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface HarvestCycleOptions {
  limit?: number;
  delayMs?: number;
  trigger?: "cron" | "script";
}

export async function runDarbRateHarvestCycle(
  admin: SupabaseClient,
  options: HarvestCycleOptions = {},
): Promise<HarvestRunSummary> {
  const empty: HarvestRunSummary = {
    requested: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    circuitOpened: false,
    status: "completed",
  };

  // ── Accounts. Select by code and keep every row: Libya runs two Darb
  //    accounts and both need their own price list.
  const { data: carrierData, error: carrierError } = await admin
    .from("carriers")
    .select("id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (carrierError) throw new Error(`carriers fetch failed: ${carrierError.message}`);
  if (!carrierData || carrierData.length === 0) return empty;

  // The service plan to quote with. Probed portable across both accounts, so a
  // row missing default_service_id falls back to the catalogue default rather
  // than being skipped (the Benghazi row has none).
  const { data: serviceData } = await admin
    .from("darb_services")
    .select("service_id, is_default")
    .order("sort_order", { ascending: true });
  const fallbackServiceId =
    ((serviceData ?? []).find((s) => s.is_default)?.service_id as string) ??
    ((serviceData ?? [])[0]?.service_id as string) ??
    "";
  if (!fallbackServiceId) throw new Error("darb_services is empty — nothing to quote with");

  const configByCarrier = new Map<string, CarrierConfig>();
  const accounts = carrierData.flatMap((row) => {
    let config: CarrierConfig;
    try {
      config = buildConfig(row as unknown as CarrierRow);
    } catch (e) {
      // One misconfigured account must not sink the other's harvest.
      console.error(`[darb-rate-harvest] skipping ${row.name}:`, e);
      return [];
    }
    configByCarrier.set(row.id as string, config);
    return [
      {
        carrierId: row.id as string,
        serviceId: config.apiCredentials.default_service_id || fallbackServiceId,
      },
    ];
  });
  if (accounts.length === 0) return empty;

  // ── Plan, stalest-first so a capped run resumes next cycle.
  const destinations = Object.entries(DARB_ASSABIL_CITIES).flatMap(([city, areas]) =>
    areas.map((area) => ({ city, area })),
  );
  const plan = buildHarvestPlan({ carriers: accounts, destinations });

  const { data: existing } = await admin
    .from("darb_shipping_rates")
    .select("carrier_id, city, area, quoted_at")
    .in(
      "carrier_id",
      accounts.map((a) => a.carrierId),
    );
  const quotedAtByKey = new Map<string, string>(
    (existing ?? []).map((r) => [
      cellKey({ carrierId: r.carrier_id as string, city: r.city as string, area: r.area as string }),
      r.quoted_at as string,
    ]),
  );
  const cells = orderCellsByStaleness(plan, quotedAtByKey);

  // ── Run.
  const { data: run, error: runError } = await admin
    .from("darb_rate_harvest_runs")
    .insert({
      trigger: options.trigger ?? "cron",
      requested: options.limit != null ? Math.min(options.limit, cells.length) : cells.length,
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`could not open a harvest run: ${runError?.message}`);
  const runId = run.id as string;

  const summary = await runHarvest({
    cells,
    limit: options.limit,
    delayMs: options.delayMs ?? 250,
    runId,
    now: () => new Date(),
    sleep,
    quote: (cell) => {
      const config = configByCarrier.get(cell.carrierId);
      if (!config) throw new Error(`no config for carrier ${cell.carrierId}`);
      return fetchDarbQuote(config, {
        serviceId: cell.serviceId,
        city: cell.city,
        area: cell.area,
        amount: HARVEST_QUOTE_AMOUNT,
      });
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

  return summary;
}
