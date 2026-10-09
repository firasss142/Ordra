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
import { XDeliveryPortal, type PortalLogin, type PortalManifest } from "./portal";
import {
  PICKUP_LOG_KIND,
  PICKUP_MARKED,
  PICKUP_REQUESTED,
  type PickupBatchDeps,
  type PickupLogEntry,
  type PickupManifestRow,
  type ReleaseDeps,
} from "./pickup";
import {
  MANIFEST_SYNC_LOG_KIND,
  type ManifestKind,
  type ManifestSyncAccount,
  type ManifestSyncDeps,
  type StoredPickupLine,
} from "./manifest-sync";

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


// ── Manifests: pickup on demand, its undo, and the list sync ─────
// plans/xdelivery-manifests.md · docs/xdelivery-manifests.md

/** An X-Delivery account with the portal login stored in its credentials (or null). */
export interface XDeliveryPortalAccount extends ManifestSyncAccount {
  isActive: boolean;
}

function portalLoginOf(encrypted: string | null): PortalLogin | null {
  try {
    const creds = JSON.parse(decrypt(encrypted ?? "")) as Record<string, string>;
    return creds.portal_email && creds.portal_password
      ? { email: creds.portal_email, password: creds.portal_password }
      : null;
  } catch {
    // unreadable credentials = no login; the caller reports no_portal_login
    return null;
  }
}

/** Active X-Delivery accounts, optionally only these ids. Service role. */
export async function loadXDeliveryPortalAccounts(
  admin: SupabaseClient,
  carrierIds?: string[],
): Promise<XDeliveryPortalAccount[]> {
  let q = admin
    .from("carriers")
    .select("id, market_id, warehouse_id, api_credentials, is_active, created_at")
    .eq("code", "xdelivery")
    .eq("is_active", true);
  if (carrierIds) q = q.in("id", carrierIds);
  const { data, error } = await q;
  if (error) throw new Error(`xdelivery accounts: ${error.message}`);
  return (
    (data ?? []) as Array<{
      id: string;
      market_id: string;
      warehouse_id: string | null;
      api_credentials: string | null;
      is_active: boolean;
      created_at: string | null;
    }>
  ).map((row) => ({
    carrierId: row.id,
    marketId: row.market_id,
    warehouseId: row.warehouse_id,
    isActive: row.is_active,
    login: portalLoginOf(row.api_credentials),
    // Lists older than the account's set-up in Ordra are history (manifest-sync.ts).
    importFrom: row.created_at,
  }));
}

async function logManifestEvent(
  admin: SupabaseClient,
  account: { carrierId: string; marketId: string },
  source: "manual" | "cron",
  kind: string,
  entry: PickupLogEntry & { error?: boolean },
): Promise<void> {
  // Forensic only: a log failure never changes what happened to an order.
  await admin.from("carrier_event_log").insert({
    carrier_code: "xdelivery",
    source,
    carrier_id: account.carrierId,
    market_id: account.marketId,
    order_id: entry.orderId ?? null,
    outcome: entry.error ? "error" : "processed",
    outcome_reason: entry.reason,
    raw_body: { kind, count: entry.count ?? 0 },
  });
}

const kindOfList: Record<ManifestKind, ManifestKind> = { pickup: "pickup", return: "return", exchange: "exchange" };

/**
 * Upserts lists and their lines. A line is only ever INSERTED, or given the order
 * it was missing: its state (scanned, removed) belongs to the warehouse and to the
 * undo, never to the sync. Lines are linked to Ordra orders of this account by
 * tracking number; a parcel Ordra does not know keeps order_id NULL.
 */
export async function saveManifestsToDb(
  admin: SupabaseClient,
  account: { carrierId: string; marketId: string; warehouseId: string | null },
  kind: ManifestKind,
  lists: PortalManifest[],
  requestedBy: string | null = null,
): Promise<Map<string, string>> {
  const rowIdByExternal = new Map<string, string>();
  if (lists.length === 0) return rowIdByExternal;
  const now = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("carrier_manifests")
    .upsert(
      lists.map((m) => ({
        market_id: account.marketId,
        carrier_id: account.carrierId,
        warehouse_id: account.warehouseId,
        kind: kindOfList[kind],
        external_id: m.id,
        code: m.code,
        carrier_status: m.status || null,
        carrier_created_at: m.createdAt,
        synced_at: now,
        ...(requestedBy ? { requested_by: requestedBy } : {}),
      })),
      { onConflict: "carrier_id,external_id" },
    )
    .select("id, external_id");
  if (error) throw new Error(`carrier_manifests upsert: ${error.message}`);
  for (const r of (rows ?? []) as Array<{ id: string; external_id: string }>) rowIdByExternal.set(r.external_id, r.id);

  const barcodes = [...new Set(lists.flatMap((m) => m.parcels.map((p) => p.barcode)))];
  const orderByBarcode = new Map<string, string>();
  for (let i = 0; i < barcodes.length; i += 200) {
    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, tracking_number")
      .eq("carrier_id", account.carrierId)
      .in("tracking_number", barcodes.slice(i, i + 200));
    if (oErr) throw new Error(`manifest orders: ${oErr.message}`);
    for (const o of (orders ?? []) as Array<{ id: string; tracking_number: string }>) {
      orderByBarcode.set(o.tracking_number, o.id);
    }
  }

  const manifestIds = [...rowIdByExternal.values()];
  const { data: existing, error: eErr } = await admin
    .from("carrier_manifest_parcels")
    .select("id, manifest_id, barcode, order_id")
    .in("manifest_id", manifestIds);
  if (eErr) throw new Error(`manifest lines: ${eErr.message}`);
  const have = new Map(
    ((existing ?? []) as Array<{ id: string; manifest_id: string; barcode: string; order_id: string | null }>).map((l) => [
      `${l.manifest_id}|${l.barcode}`,
      l,
    ]),
  );

  const inserts: Array<Record<string, unknown>> = [];
  for (const m of lists) {
    const manifestId = rowIdByExternal.get(m.id);
    if (!manifestId) continue;
    for (const p of m.parcels) {
      const known = have.get(`${manifestId}|${p.barcode}`);
      const orderId = orderByBarcode.get(p.barcode) ?? null;
      if (!known) {
        inserts.push({ manifest_id: manifestId, barcode: p.barcode, external_parcel_id: p.id, order_id: orderId });
        have.set(`${manifestId}|${p.barcode}`, { id: "", manifest_id: manifestId, barcode: p.barcode, order_id: orderId });
      } else if (!known.order_id && orderId && known.id) {
        const { error: uErr } = await admin.from("carrier_manifest_parcels").update({ order_id: orderId }).eq("id", known.id);
        if (uErr) throw new Error(`manifest line link: ${uErr.message}`);
      }
    }
  }
  if (inserts.length > 0) {
    const { error: iErr } = await admin
      .from("carrier_manifest_parcels")
      .upsert(inserts, { onConflict: "manifest_id,barcode", ignoreDuplicates: true });
    if (iErr) throw new Error(`manifest lines insert: ${iErr.message}`);
  }
  return rowIdByExternal;
}

async function markLinesRemoved(admin: SupabaseClient, lineIds: string[], source: "ordra" | "carrier"): Promise<void> {
  if (lineIds.length === 0) return;
  const { error } = await admin
    .from("carrier_manifest_parcels")
    .update({ state: "removed", removed_at: new Date().toISOString(), removed_source: source })
    .in("id", lineIds)
    .eq("state", "expected");
  if (error) throw new Error(`manifest lines removed: ${error.message}`);
}

async function markManifestDeleted(
  admin: SupabaseClient,
  manifestId: string,
  actorId: string | null,
  source: "ordra" | "carrier",
): Promise<void> {
  const { error } = await admin
    .from("carrier_manifests")
    .update({ deleted_at: new Date().toISOString(), deleted_by: actorId, deleted_source: source })
    .eq("id", manifestId)
    .is("deleted_at", null);
  if (error) throw new Error(`manifest deleted: ${error.message}`);
}

async function releaseOrder(
  admin: SupabaseClient,
  orderId: string,
  actorId: string | null,
  note: string,
): Promise<{ released: boolean; status: string }> {
  const { data, error } = await admin.rpc("release_pickup_parcel", {
    p_order_id: orderId,
    p_actor_id: actorId,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { released?: boolean; status?: string };
  return { released: r.released === true, status: String(r.status ?? "") };
}

/** Order ids on a pickup list Ordra holds as open (not deleted, line still expected). */
async function onOpenPickupList(admin: SupabaseClient, orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("carrier_manifest_parcels")
    .select("order_id, carrier_manifests!inner ( kind, deleted_at )")
    .in("order_id", orderIds)
    .eq("state", "expected")
    .eq("carrier_manifests.kind", "pickup")
    .is("carrier_manifests.deleted_at", null);
  if (error) throw new Error(`open pickup lines: ${error.message}`);
  return new Set(((data ?? []) as Array<{ order_id: string }>).map((r) => r.order_id));
}

export function buildPickupBatchDeps(
  admin: SupabaseClient,
  account: XDeliveryPortalAccount,
  portal: PickupBatchDeps["portal"],
): PickupBatchDeps {
  const sync = buildXDeliverySyncDeps(admin, [account.carrierId]);
  return {
    portal,
    loadCandidates: async (carrierId, orderIds) => {
      if (orderIds.length === 0) return [];
      const { data, error } = await admin
        .from("orders")
        .select("id, tracking_number")
        .in("id", orderIds)
        .eq("carrier_id", carrierId)
        .eq("status", "scanned")
        .is("archived_at", null)
        .not("tracking_number", "is", null)
        .neq("tracking_number", "");
      if (error) throw new Error(`pickup candidates: ${error.message}`);
      const rows = (data ?? []) as Array<{ id: string; tracking_number: string }>;
      const busy = await onOpenPickupList(admin, rows.map((r) => r.id));
      return rows.filter((r) => !busy.has(r.id)).map((r) => ({ orderId: r.id, barcode: r.tracking_number }));
    },
    markRequested: async (orderId) => {
      await sync.promote({ orderId, target: null, slug: "PENDING", note: "X-Delivery: demande d'enlèvement envoyée" });
      await logManifestEvent(admin, account, "manual", PICKUP_LOG_KIND, { carrierId: account.carrierId, reason: PICKUP_MARKED, orderId });
    },
    saveManifest: async ({ manifest, requestedBy }) => {
      const ids = await saveManifestsToDb(admin, account, "pickup", [manifest], requestedBy);
      const id = ids.get(manifest.id);
      if (!id) throw new Error("pickup list not saved");
      return id;
    },
    log: (entry) => logManifestEvent(admin, account, "manual", PICKUP_LOG_KIND, entry),
    now: () => new Date(),
  };
}

export async function loadPickupManifest(admin: SupabaseClient, manifestId: string): Promise<PickupManifestRow | null> {
  const { data, error } = await admin
    .from("carrier_manifests")
    .select(
      "id, external_id, carrier_id, warehouse_id, kind, deleted_at, carrier_manifest_parcels ( id, barcode, order_id, external_parcel_id, state, created_at )",
    )
    .eq("id", manifestId)
    .maybeSingle();
  if (error) throw new Error(`manifest: ${error.message}`);
  if (!data) return null;
  const row = data as {
    id: string;
    external_id: string;
    carrier_id: string;
    warehouse_id: string | null;
    kind: PickupManifestRow["kind"];
    deleted_at: string | null;
    carrier_manifest_parcels: Array<{
      id: string;
      barcode: string;
      order_id: string | null;
      external_parcel_id: string | null;
      state: PickupManifestRow["lines"][number]["state"];
      created_at: string;
    }>;
  };
  return {
    id: row.id,
    externalId: row.external_id,
    carrierId: row.carrier_id,
    warehouseId: row.warehouse_id,
    kind: row.kind,
    deletedAt: row.deleted_at,
    lines: [...(row.carrier_manifest_parcels ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.barcode.localeCompare(b.barcode))
      .map((l) => ({
        lineId: l.id,
        barcode: l.barcode,
        orderId: l.order_id,
        externalParcelId: l.external_parcel_id,
        state: l.state,
      })),
  };
}

export function buildReleaseDeps(
  admin: SupabaseClient,
  account: XDeliveryPortalAccount,
  portal: ReleaseDeps["portal"],
): ReleaseDeps {
  return {
    portal,
    loadManifest: (id) => loadPickupManifest(admin, id),
    release: (orderId, actorId, note) => releaseOrder(admin, orderId, actorId, note),
    markLinesRemoved: (ids, source) => markLinesRemoved(admin, ids, source),
    markManifestDeleted: (id, actorId, source) => markManifestDeleted(admin, id, actorId, source),
    log: (entry) => logManifestEvent(admin, account, "manual", PICKUP_LOG_KIND, entry),
  };
}

export function buildManifestSyncDeps(admin: SupabaseClient, carrierIds?: string[]): ManifestSyncDeps {
  const accounts = new Map<string, XDeliveryPortalAccount>();
  const accountOf = (carrierId: string) =>
    accounts.get(carrierId) ?? { carrierId, marketId: "", warehouseId: null };
  return {
    listAccounts: async () => {
      const list = await loadXDeliveryPortalAccounts(admin, carrierIds);
      for (const a of list) accounts.set(a.carrierId, a);
      return list;
    },
    portalFor: (login) => new XDeliveryPortal(login),
    saveManifests: async (account, kind, lists) => {
      await saveManifestsToDb(admin, account, kind, lists);
    },
    openPickupLines: async (carrierId, createdSince) => {
      const { data, error } = await admin
        .from("carrier_manifest_parcels")
        .select("id, barcode, order_id, carrier_manifests!inner ( id, external_id, carrier_id, kind, deleted_at, carrier_created_at )")
        .eq("state", "expected")
        .eq("carrier_manifests.carrier_id", carrierId)
        .eq("carrier_manifests.kind", "pickup")
        .is("carrier_manifests.deleted_at", null)
        .gte("carrier_manifests.carrier_created_at", createdSince.toISOString());
      if (error) throw new Error(`open pickup lines: ${error.message}`);
      return (
        (data ?? []) as unknown as Array<{
          id: string;
          barcode: string;
          order_id: string | null;
          carrier_manifests: { id: string; external_id: string };
        }>
      ).map(
        (r): StoredPickupLine => ({
          lineId: r.id,
          manifestId: r.carrier_manifests.id,
          externalManifestId: r.carrier_manifests.external_id,
          barcode: r.barcode,
          orderId: r.order_id,
        }),
      );
    },
    release: (orderId, actorId, note) => releaseOrder(admin, orderId, actorId, note),
    markLinesRemoved: (ids, source) => markLinesRemoved(admin, ids, source),
    markManifestDeleted: (id, actorId, source) => markManifestDeleted(admin, id, actorId, source),
    log: (entry) => logManifestEvent(admin, accountOf(entry.carrierId), "cron", MANIFEST_SYNC_LOG_KIND, entry),
    now: () => new Date(),
  };
}
