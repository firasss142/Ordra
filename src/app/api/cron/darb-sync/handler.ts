import type { SupabaseClient } from "@supabase/supabase-js";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import {
  runDarbSyncCycle,
  buildDarbSyncDeps,
  DARB_PAGE_SIZE,
  type DarbSyncResult,
} from "@/lib/carriers/darb-sync-cycle";
import type { CarrierConfig } from "@/lib/carriers/types";

/**
 * Darb Assabil scheduled sweep.
 *
 * Runs across EVERY active darb_assabil carrier account (Tripoli + Benghazi),
 * mirroring each account's full shipment list. At 500 records/page that is ~3
 * HTTP calls total, so the whole sweep fits comfortably inside the function
 * budget — unlike the old per-order path, which was killed mid-sweep and left
 * orders permanently un-refreshed.
 *
 * Each account gets its own darb_sync_runs row so a single account failing
 * (expired key, vendor outage) is visible and does not hide the other.
 */

export interface DarbCronInput {
  headers: Headers;
  expectedSecret: string;
  admin: SupabaseClient;
  /** ISO watermark for a delta sweep; omit for a full sweep. */
  since?: string | null;
}

export interface DarbCronResponse {
  status: number;
  body: {
    success?: boolean;
    results?: DarbSyncResult[];
    error?: string;
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleDarbSyncCronRequest(
  input: DarbCronInput,
): Promise<DarbCronResponse> {
  if (!input.expectedSecret) {
    return { status: 500, body: { error: "CRON_SECRET not configured" } };
  }
  const provided = input.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(provided, input.expectedSecret)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  try {
    const results = await runDarbSyncForAllAccounts(input.admin, input.since ?? null);
    return { status: 200, body: { success: true, results } };
  } catch (err) {
    return { status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * Sweep every active Darb account. Exported so the reconcile script and the
 * app-launch route drive exactly the same code path.
 */
export async function runDarbSyncForAllAccounts(
  admin: SupabaseClient,
  since: string | null,
  trigger: "cron" | "manual" | "app_launch" | "reconcile" = "cron",
): Promise<DarbSyncResult[]> {
  const { data, error } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, delivery_fee, return_fee")
    .eq("code", "darb_assabil")
    .eq("is_active", true);
  if (error) throw new Error(`load darb carriers: ${error.message}`);

  const rows = (data ?? []) as unknown as CarrierRow[];
  if (rows.length === 0) return [];

  const results: DarbSyncResult[] = [];

  for (const row of rows) {
    // A carrier whose credentials won't decrypt must not abort the other account.
    let config: CarrierConfig;
    try {
      config = buildConfig(row);
    } catch (err) {
      await admin.from("darb_sync_runs").insert({
        trigger,
        carrier_id: row.id,
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: `buildConfig: ${err instanceof Error ? err.message : String(err)}`,
      });
      results.push({
        carrierId: row.id,
        pagesFetched: 0,
        shipmentsSeen: 0,
        shipmentsUpserted: 0,
        eventsInserted: 0,
        commentsInserted: 0,
        ordersMatched: 0,
        ordersPromoted: 0,
        stoppedEarly: false,
        status: "failed",
        errorMessage: "buildConfig failed",
      });
      continue;
    }

    const { data: runRow } = await admin
      .from("darb_sync_runs")
      .insert({ trigger, carrier_id: row.id, status: "running" })
      .select("id")
      .single();
    const runId = (runRow as { id: string } | null)?.id ?? null;

    const deps = buildDarbSyncDeps(
      admin,
      new Map([[row.id, config]]),
      trigger === "app_launch" ? "manual" : trigger,
    );

    const result = await runDarbSyncCycle(deps, {
      carrierId: row.id,
      pageSize: DARB_PAGE_SIZE,
      since,
      source: trigger === "app_launch" ? "manual" : trigger,
    });
    results.push(result);

    if (runId) {
      await admin
        .from("darb_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          pages_fetched: result.pagesFetched,
          shipments_seen: result.shipmentsSeen,
          shipments_upserted: result.shipmentsUpserted,
          events_inserted: result.eventsInserted,
          orders_matched: result.ordersMatched,
          orders_promoted: result.ordersPromoted,
          status: result.status,
          error_message: result.errorMessage,
          notes: { stoppedEarly: result.stoppedEarly, since },
        })
        .eq("id", runId);
    }
  }

  return results;
}
