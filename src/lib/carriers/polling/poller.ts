import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";
import { mapNavexStatus, mapDexpressStatus } from "./status-map";
import { parseNavexResponse, parseDexpressBatchResponse } from "./extractors";
import {
  fetchNavexStatus as fetchNavexStatusImpl,
  fetchDexpressBatch as fetchDexpressBatchImpl,
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

const DEXPRESS_BATCH_SIZE = 50;

export interface OpenOrderForPoll {
  order_id: string;
  tracking_number: string;
  status: OrderStatus;
  carrier_code: "navex" | "dexpress";
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
  carrier_code: "navex" | "dexpress";
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
  fetchDexpressBatch: (trackings: string[], row: CarrierRowForPoll) => Promise<unknown>;
  applyFulfillment: (input: ApplyFulfillmentInput) => Promise<void>;
  writeLog: (entry: LogEntry) => Promise<void>;
}

export interface PollRunResult {
  carrierCode: "navex" | "dexpress";
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

  const dexpress = orders.filter((o) => o.carrier_code === "dexpress");
  if (dexpress.length > 0) {
    results.push(await pollDexpress(dexpress, deps));
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

async function pollDexpress(
  orders: OpenOrderForPoll[],
  deps: PollerDeps
): Promise<PollRunResult> {
  let processed = 0;
  let ignored = 0;
  let errored = 0;

  // Group orders by identical (api_credentials, api_endpoint) to form per-carrier-account batches.
  // In practice there's one Dexpress carrier row per market; we still guard against multiples.
  const groups = new Map<string, OpenOrderForPoll[]>();
  for (const o of orders) {
    const key = `${o.api_credentials ?? ""}::${o.api_endpoint ?? ""}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(o);
    groups.set(key, bucket);
  }

  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += DEXPRESS_BATCH_SIZE) {
      const chunk = group.slice(i, i + DEXPRESS_BATCH_SIZE);
      const trackings = chunk.map((o) => o.tracking_number);
      const orderByTracking = new Map(
        chunk.map((o) => [o.tracking_number, o])
      );

      let raw: unknown;
      try {
        raw = await deps.fetchDexpressBatch(trackings, {
          api_credentials: chunk[0].api_credentials,
          api_endpoint: chunk[0].api_endpoint,
        });
      } catch (err) {
        // Entire batch failed — log error row per tracking number
        for (const o of chunk) {
          await deps.writeLog({
            carrier_code: "dexpress",
            source: "poll",
            tracking_number: o.tracking_number,
            carrier_status_raw: null,
            order_id: o.order_id,
            outcome: "error",
            outcome_reason: err instanceof Error ? err.message : String(err),
            raw_body: null,
          });
          errored++;
        }
        continue;
      }

      const parsedResults = parseDexpressBatchResponse(raw);
      const returned = new Set<string>();

      for (const entry of parsedResults) {
        returned.add(entry.trackingNumber);
        const order = orderByTracking.get(entry.trackingNumber);
        if (!order) {
          // Dexpress returned a tracking we didn't ask about — safe to ignore.
          continue;
        }

        const mapping = mapDexpressStatus(entry.statusKey, entry.nameStatus);
        if (!mapping) {
          await deps.writeLog({
            carrier_code: "dexpress",
            source: "poll",
            tracking_number: entry.trackingNumber,
            carrier_status_raw: `${entry.statusKey}:${entry.nameStatus}`,
            order_id: order.order_id,
            outcome: "ignored",
            outcome_reason: `unknown_dexpress_status_key:${entry.statusKey}:${entry.nameStatus}`,
            raw_body: entry.rawBody,
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
            carrier_code: "dexpress",
            source: "poll",
            tracking_number: entry.trackingNumber,
            carrier_status_raw: `${entry.statusKey}:${entry.nameStatus}`,
            order_id: order.order_id,
            outcome: "processed",
            outcome_reason: null,
            raw_body: entry.rawBody,
          });
          processed++;
        } catch (err) {
          await deps.writeLog({
            carrier_code: "dexpress",
            source: "poll",
            tracking_number: entry.trackingNumber,
            carrier_status_raw: `${entry.statusKey}:${entry.nameStatus}`,
            order_id: order.order_id,
            outcome: "error",
            outcome_reason: err instanceof Error ? err.message : String(err),
            raw_body: entry.rawBody,
          });
          errored++;
        }
      }

      // Log ignored for any tracking number the carrier did not return in this batch.
      for (const o of chunk) {
        if (!returned.has(o.tracking_number)) {
          await deps.writeLog({
            carrier_code: "dexpress",
            source: "poll",
            tracking_number: o.tracking_number,
            carrier_status_raw: null,
            order_id: o.order_id,
            outcome: "ignored",
            outcome_reason: "not_in_response",
            raw_body: null,
          });
          ignored++;
        }
      }
    }
  }

  return {
    carrierCode: "dexpress",
    polled: orders.length,
    processed,
    ignored,
    errored,
  };
}

// ============================================================
// Production wiring — supplies real Supabase-backed deps.
// ============================================================

export function buildProductionDeps(admin: SupabaseClient): PollerDeps {
  return {
    fetchOpenOrders: async () => {
      const { data, error } = await admin
        .from("orders")
        .select(
          `id, tracking_number, status,
           carriers!inner ( code, api_credentials, api_endpoint )`
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
        if (code !== "navex" && code !== "dexpress") continue;
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
    fetchDexpressBatch: fetchDexpressBatchImpl,

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
