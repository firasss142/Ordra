/**
 * Supabase-backed dependencies for the X-Delivery sync (webhook + poll).
 * Service-role client only: `promote_carrier_status` is granted to nobody else.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@/types/order-status";
import { buildConfig, type CarrierRow } from "../dispatch";
import type { CarrierConfig } from "../types";
import { fetchXDeliveryStatuses } from "./client";
import type { XDeliveryAccountKey } from "./webhook";
import type { OpenXDeliveryParcel, PromoteResult, XDeliveryPollDeps, XDeliverySyncDeps } from "./sync";
import { decrypt } from "@/lib/crypto";
import { isPickupDisabledNow } from "../pickup-window";
import { XDeliveryPortal } from "./portal";
import {
  PICKUP_LOG_KIND,
  PICKUP_MARKED,
  PICKUP_REQUESTED,
  xdeliveryPickupKey,
  type PickupAccount,
  type PickupDeps,
} from "./pickup";

/**
 * Statuses worth asking about. `to_be_returned` is left out: the carrier side
 * is finished, and only our bench scan moves it on. Delivered parcels are
 * covered by the webhook (a later return there is the decision-7 conflict).
 */
export const XDELIVERY_OPEN_STATUSES: OrderStatus[] = [
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "out_for_delivery",
  "delivery_delayed",
  "returning",
];

const CARRIER_COLUMNS = "id, code, api_endpoint, api_credentials, delivery_fee, return_fee";

async function loadAccountRows(admin: SupabaseClient): Promise<CarrierRow[]> {
  const { data, error } = await admin.from("carriers").select(CARRIER_COLUMNS).eq("code", "xdelivery");
  if (error) throw new Error(`xdelivery accounts: ${error.message}`);
  return (data ?? []) as CarrierRow[];
}

/** Every X-Delivery account whose credentials decrypt, with its API key (the webhook Bearer). */
export async function loadXDeliveryAccounts(admin: SupabaseClient): Promise<XDeliveryAccountKey[]> {
  const out: XDeliveryAccountKey[] = [];
  for (const row of await loadAccountRows(admin)) {
    try {
      const key = buildConfig(row).apiCredentials.api_key;
      if (key) out.push({ carrierId: row.id, apiKey: key });
    } catch {
      // an account without readable credentials cannot have sent anything
    }
  }
  return out;
}

/**
 * @param carrierIds When set (webhook), only these accounts' parcels can be touched.
 */
export function buildXDeliverySyncDeps(admin: SupabaseClient, carrierIds?: string[]): XDeliverySyncDeps {
  return {
    findOrders: async (barcodes) => {
      if (barcodes.length === 0) return [];
      let q = admin
        .from("orders")
        .select("id, tracking_number, carrier_id, carriers!orders_carrier_id_fkey!inner ( code )")
        .in("tracking_number", barcodes)
        .eq("carriers.code", "xdelivery");
      if (carrierIds) q = q.in("carrier_id", carrierIds);
      const { data, error } = await q;
      if (error) throw new Error(`xdelivery findOrders: ${error.message}`);
      return ((data ?? []) as { id: string; tracking_number: string }[]).map((r) => ({
        order_id: r.id,
        tracking_number: r.tracking_number,
      }));
    },

    promote: async ({ orderId, target, slug, note }) => {
      const { data, error } = await admin.rpc("promote_carrier_status", {
        p_order_id: orderId,
        p_carrier_code: "xdelivery",
        p_target: target,
        p_slug: slug,
        p_note: note,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        promoted: r.promoted === true,
        status: String(r.status ?? ""),
        conflict: typeof r.conflict === "string" ? r.conflict : null,
      } satisfies PromoteResult;
    },

    writeLog: async (entry) => {
      const { error } = await admin.from("carrier_event_log").insert(entry);
      if (error) throw new Error(error.message);
    },
  };
}

export function buildXDeliveryPollDeps(admin: SupabaseClient): XDeliveryPollDeps {
  const configs = new Map<string, CarrierConfig>();

  return {
    ...buildXDeliverySyncDeps(admin),

    fetchOpenParcels: async () => {
      const { data, error } = await admin
        .from("orders")
        .select("id, tracking_number, carrier_id, carriers!orders_carrier_id_fkey!inner ( code )")
        .eq("carriers.code", "xdelivery")
        .in("status", XDELIVERY_OPEN_STATUSES)
        .is("archived_at", null)
        .not("tracking_number", "is", null)
        .neq("tracking_number", "");
      if (error) throw new Error(`xdelivery fetchOpenParcels: ${error.message}`);
      return ((data ?? []) as { id: string; tracking_number: string; carrier_id: string }[]).map(
        (r): OpenXDeliveryParcel => ({
          order_id: r.id,
          tracking_number: r.tracking_number,
          carrier_id: r.carrier_id,
        }),
      );
    },

    fetchStatuses: async (carrierId, barcodes) => {
      let config = configs.get(carrierId);
      if (!config) {
        const row = (await loadAccountRows(admin)).find((r) => r.id === carrierId);
        if (!row) throw new Error(`xdelivery account ${carrierId} not found`);
        config = buildConfig(row);
        configs.set(carrierId, config);
      }
      return fetchXDeliveryStatuses(config, barcodes);
    },
  };
}

// ── Pickup request (decision 6) ───────────────────────────────────

export function buildXDeliveryPickupDeps(admin: SupabaseClient): PickupDeps {
  const sync = buildXDeliverySyncDeps(admin);
  const marketOf = new Map<string, string>();

  return {
    listAccounts: async () => {
      const { data, error } = await admin
        .from("carriers")
        .select("id, market_id, warehouse_id, api_credentials")
        .eq("code", "xdelivery")
        .eq("is_active", true);
      if (error) throw new Error(`xdelivery pickup accounts: ${error.message}`);
      return ((data ?? []) as {
        id: string;
        market_id: string;
        warehouse_id: string | null;
        api_credentials: string | null;
      }[]).map((row): PickupAccount => {
        marketOf.set(row.id, row.market_id);
        let login: PickupAccount["login"] = null;
        try {
          const creds = JSON.parse(decrypt(row.api_credentials ?? "")) as Record<string, string>;
          if (creds.portal_email && creds.portal_password) {
            login = { email: creds.portal_email, password: creds.portal_password };
          }
        } catch {
          // unreadable credentials = no login; reported as no_portal_login
        }
        return { carrierId: row.id, marketId: row.market_id, warehouseId: row.warehouse_id, login };
      });
    },

    isSwitchOff: async (marketId, warehouseId) => {
      const { data } = await admin
        .from("settings")
        .select("value")
        .eq("market_id", marketId)
        .eq("key", xdeliveryPickupKey(warehouseId))
        .maybeSingle<{ value: unknown }>();
      return isPickupDisabledNow(data?.value, marketId);
    },

    listAwaiting: async (carrierId) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, tracking_number")
        .eq("carrier_id", carrierId)
        .eq("status", "scanned")
        .is("archived_at", null)
        .not("tracking_number", "is", null)
        .or("carrier_status_slug.is.null,carrier_status_slug.eq.CREATED");
      if (error) throw new Error(`xdelivery awaiting pickup: ${error.message}`);
      return ((data ?? []) as { id: string; tracking_number: string }[]).map((r) => ({
        orderId: r.id,
        barcode: r.tracking_number,
      }));
    },

    portalFor: (login) => new XDeliveryPortal(login),

    markRequested: async (orderId, carrierId) => {
      await sync.promote({
        orderId,
        target: null,
        slug: "PENDING",
        note: "X-Delivery: demande d'enlèvement envoyée",
      });
      // The parcel's own row is the bench's « Demandé 14:20 »: synced_at moves on every
      // poll, so it cannot say when the request went.
      await admin.from("carrier_event_log").insert({
        carrier_code: "xdelivery",
        source: "cron",
        carrier_id: carrierId,
        market_id: marketOf.get(carrierId) ?? null,
        order_id: orderId,
        carrier_status_raw: "PENDING",
        outcome: "processed",
        outcome_reason: PICKUP_MARKED,
        raw_body: { kind: PICKUP_LOG_KIND },
      });
    },

    log: async ({ carrierId, reason, count }) => {
      await admin.from("carrier_event_log").insert({
        carrier_code: "xdelivery",
        source: "cron",
        carrier_id: carrierId,
        market_id: marketOf.get(carrierId) ?? null,
        outcome: reason === PICKUP_REQUESTED ? "processed" : "error",
        outcome_reason: reason,
        raw_body: { kind: PICKUP_LOG_KIND, count: count ?? 0 },
      });
    },
  };
}
