import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";
import { mapNavexStatus } from "./status-map";
import { parseNavexResponse } from "./extractors";
import {
  fetchNavexStatus as fetchNavexStatusImpl,
  type CarrierRowForPoll,
} from "./clients";
import { applyFulfillmentTransition } from "@/lib/orders/fulfillment";

const OPEN_STATUSES: OrderStatus[] = [
  "dispatched",
  "deposit",
  "in_transit",
  "unverified",
  "to_be_returned",
];

export interface OpenOrderForPoll {
  order_id: string;
  tracking_number: string;
  status: OrderStatus;
  carrier_code: "navex";
  api_credentials: string | null;
  api_endpoint: string | null;
}

export interface ApplyFulfillmentInput {
  orderId: string;
  newStatus: OrderStatus;
  isDamaged: boolean;
  note: string;
}

export interface LogEntry {
  carrier_code: "navex";
  source: "poll";
  tracking_number: string;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
}

export interface PollerDeps {
  fetchOpenOrders: () => Promise<OpenOrderForPoll[]>;
  fetchNavexStatus: (tracking: string, row: CarrierRowForPoll) => Promise<unknown>;
  applyFulfillment: (input: ApplyFulfillmentInput) => Promise<void>;
  writeLog: (entry: LogEntry) => Promise<void>;
}

export interface PollRunResult {
  carrierCode: "navex";
  polled: number;
  processed: number;
  ignored: number;
  errored: number;
}

export async function runPollCycle(
  deps: PollerDeps
): Promise<PollRunResult[]> {
  const orders = await deps.fetchOpenOrders();
  if (orders.length === 0) return [];

  const results: PollRunResult[] = [];

  const navex = orders.filter((o) => o.carrier_code === "navex");
  if (navex.length > 0) {
    results.push(await pollNavex(navex, deps));
  }

  return results;
}

async function pollNavex(
  orders: OpenOrderForPoll[],
  deps: PollerDeps
): Promise<PollRunResult> {
  let processed = 0;
  let ignored = 0;
  let errored = 0;

  for (const order of orders) {
    try {
      const raw = await deps.fetchNavexStatus(order.tracking_number, {
        api_credentials: order.api_credentials,
        api_endpoint: order.api_endpoint,
      });

      const parsed = parseNavexResponse(order.tracking_number, raw);
      if (parsed.etat === null) {
        await deps.writeLog({
          carrier_code: "navex",
          source: "poll",
          tracking_number: order.tracking_number,
          carrier_status_raw: null,
          order_id: order.order_id,
          outcome: "ignored",
          outcome_reason: "empty_etat",
          raw_body: raw,
        });
        ignored++;
        continue;
      }

      const mapping = mapNavexStatus(parsed.etat);
      if (!mapping) {
        await deps.writeLog({
          carrier_code: "navex",
          source: "poll",
          tracking_number: order.tracking_number,
          carrier_status_raw: parsed.etat,
          order_id: order.order_id,
          outcome: "ignored",
          outcome_reason: `unknown_navex_etat:${parsed.etat}`,
          raw_body: raw,
        });
        ignored++;
        continue;
      }

      try {
        await deps.applyFulfillment({
          orderId: order.order_id,
          newStatus: mapping.statusTo,
          isDamaged: mapping.isDamaged,
          note: mapping.note,
        });
        await deps.writeLog({
          carrier_code: "navex",
          source: "poll",
          tracking_number: order.tracking_number,
          carrier_status_raw: parsed.etat,
          order_id: order.order_id,
          outcome: "processed",
          outcome_reason: null,
          raw_body: raw,
        });
        processed++;
      } catch (err) {
        await deps.writeLog({
          carrier_code: "navex",
          source: "poll",
          tracking_number: order.tracking_number,
          carrier_status_raw: parsed.etat,
          order_id: order.order_id,
          outcome: "error",
          outcome_reason: err instanceof Error ? err.message : String(err),
          raw_body: raw,
        });
        errored++;
      }
    } catch (err) {
      await deps.writeLog({
        carrier_code: "navex",
        source: "poll",
        tracking_number: order.tracking_number,
        carrier_status_raw: null,
        order_id: order.order_id,
        outcome: "error",
        outcome_reason: err instanceof Error ? err.message : String(err),
        raw_body: null,
      });
      errored++;
    }
  }

  return {
    carrierCode: "navex",
    polled: orders.length,
    processed,
    ignored,
    errored,
  };
}

// ============================================================
// Production wiring — supplies real Supabase-backed deps.
// Dexpress is excluded by design: Dexpress has no status API,
// so fulfillment for Dexpress orders is updated manually.
// ============================================================

export function buildProductionDeps(admin: SupabaseClient): PollerDeps {
  return {
    fetchOpenOrders: async () => {
      const { data, error } = await admin
        .from("orders")
        .select(
          // The FK must be named explicitly: `orders` has THREE foreign keys to
          // `carriers` (carrier_id, scheduled_dispatch_carrier_id,
          // recommended_carrier_id), so a bare `carriers!inner(...)` embed is
          // ambiguous and PostgREST rejects the whole query. That regressed this
          // cron to a hard 500 on every tick when recommended_carrier_id landed
          // (20260825000002) — silently, because pg_cron reports success as long
          // as pg_net delivers the request.
          `id, tracking_number, status,
           carriers!orders_carrier_id_fkey!inner ( code, api_credentials, api_endpoint )`
        )
        .in("status", OPEN_STATUSES)
        .not("tracking_number", "is", null)
        .neq("tracking_number", "");

      if (error) throw new Error(`fetchOpenOrders: ${error.message}`);

      type Row = {
        id: string;
        tracking_number: string;
        status: OrderStatus;
        carriers: {
          code: string;
          api_credentials: string | null;
          api_endpoint: string | null;
        } | null;
      };

      const rows = (data ?? []) as unknown as Row[];
      const out: OpenOrderForPoll[] = [];
      for (const r of rows) {
        const code = r.carriers?.code;
        if (code !== "navex") continue; // Dexpress excluded — no API
        out.push({
          order_id: r.id,
          tracking_number: r.tracking_number,
          status: r.status,
          carrier_code: code,
          api_credentials: r.carriers?.api_credentials ?? null,
          api_endpoint: r.carriers?.api_endpoint ?? null,
        });
      }
      return out;
    },

    fetchNavexStatus: fetchNavexStatusImpl,

    applyFulfillment: async ({ orderId, newStatus, isDamaged, note }) => {
      await applyFulfillmentTransition(admin, orderId, newStatus, null, {
        isDamaged,
        note,
      });
    },

    writeLog: async (entry) => {
      const { error } = await admin.from("carrier_event_log").insert({
        carrier_code: entry.carrier_code,
        source: entry.source,
        tracking_number: entry.tracking_number,
        carrier_status_raw: entry.carrier_status_raw,
        order_id: entry.order_id,
        outcome: entry.outcome,
        outcome_reason: entry.outcome_reason,
        raw_body: entry.raw_body,
      });
      if (error) throw new Error(`writeLog: ${error.message}`);
    },
  };
}
