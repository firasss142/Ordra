/**
 * Darb Assabil sync engine — the one code path that refreshes Darb state.
 *
 * Replaces the old model of "one HTTP call per order, at concurrency 3, from a
 * browser-triggered route with no maxDuration", which was killed mid-sweep and
 * left 74 orders never caught up with. The list endpoint serves 500 shipments a
 * page, so a full two-account mirror is ~3 requests.
 *
 * Structure follows polling/poller.ts: a dependency-injected core (testable with
 * no Supabase and no network) plus a production wiring at the bottom.
 *
 * Guarantees:
 *   - orders.status is NEVER written here. `promote_darb_status` is the only
 *     sanctioned path, and it is the only thing that appends to order_history.
 *   - An unmatched shipment is still mirrored, with order_id NULL. We never
 *     guess an order link.
 *   - An unknown carrier status is logged, never thrown.
 *   - A promotion failure degrades the run to `partial`; the mirror still lands.
 *
 * See docs/darb-assabil-sync.md for the live-probed API contract.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  projectDarbShipment,
  projectDarbTimeline,
  projectDarbConversation,
  type DarbShipmentProjection,
} from "./darb-assabil-shipment";
import { fetchDarbShipmentPage } from "./darb-assabil-tracking";
import type { CarrierConfig } from "./types";

/** Darb serves 500 rows/page (verified live). Leave headroom for latency. */
export const DARB_PAGE_SIZE = 500;

export interface OrderMatchRow {
  id: string;
  tracking_number: string | null;
  /** carrier_extra->>'darb_assabil_id' */
  darb_internal_id: string | null;
}

export interface OrderIndex {
  byDarbId: Map<string, string>;
  byReference: Map<string, string>;
}

export type MatchedBy = "internal_id" | "reference" | "original_reference";

export interface DarbSyncLogEntry {
  carrier_code: "darb_assabil";
  source: "cron" | "manual" | "tracking_view" | "reconcile";
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
}

export interface DarbSyncDeps {
  /** Fetch one page for a carrier account. (carrierId, offset) → page. */
  fetchPage: (
    carrierId: string,
    offset: number,
    limit: number,
  ) => Promise<{ records: Array<Record<string, unknown>>; totalCount: number | null }>;
  loadOrderIndex: (carrierId: string) => Promise<OrderIndex>;
  upsertShipments: (rows: Array<Record<string, unknown>>) => Promise<number>;
  insertTimelineEvents: (rows: Array<Record<string, unknown>>) => Promise<number>;
  insertConversation: (rows: Array<Record<string, unknown>>) => Promise<number>;
  promoteStatus: (input: {
    orderId: string;
    slug: string | null;
    reference: string | null;
  }) => Promise<{ promoted: boolean }>;
  writeLog: (entry: DarbSyncLogEntry) => Promise<void>;
}

export interface DarbSyncResult {
  carrierId: string;
  pagesFetched: number;
  shipmentsSeen: number;
  shipmentsUpserted: number;
  eventsInserted: number;
  commentsInserted: number;
  ordersMatched: number;
  ordersPromoted: number;
  stoppedEarly: boolean;
  status: "succeeded" | "partial" | "failed";
  errorMessage: string | null;
}

// ── Pure core ────────────────────────────────────────────────────────

/**
 * Page offsets covering `totalCount`. Always at least one page: on the first
 * sweep of an account we don't know the total until the first response, and an
 * empty plan would mean never discovering it.
 */
export function planPages(totalCount: number | null, pageSize: number): number[] {
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error(`planPages: pageSize must be positive (got ${pageSize})`);
  }
  const total = typeof totalCount === "number" && totalCount > 0 ? totalCount : 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return Array.from({ length: pages }, (_, i) => i * pageSize);
}

/**
 * Index the account's orders by every key a shipment could match on.
 *
 * First writer wins on collision: the index is built from a single account's
 * orders, and a duplicate key means dirty data — silently overwriting would make
 * which order gets the status update depend on row order.
 */
export function buildOrderIndex(orders: OrderMatchRow[]): OrderIndex {
  const byDarbId = new Map<string, string>();
  const byReference = new Map<string, string>();
  for (const o of orders) {
    if (o.darb_internal_id && !byDarbId.has(o.darb_internal_id)) {
      byDarbId.set(o.darb_internal_id, o.id);
    }
    if (o.tracking_number && !byReference.has(o.tracking_number)) {
      byReference.set(o.tracking_number, o.id);
    }
  }
  return { byDarbId, byReference };
}

/**
 * Resolve a shipment to an OMS order.
 *
 * Ladder, most to least authoritative:
 *   1. internal `_id`         — survives re-referencing; correct for healthy orders
 *   2. current reference      — the carrier's present human code
 *   3. original SH… reference — recovered from the carrier's #tags; this is the
 *      rung that reconnects orders stranded on a creation-time reference
 *
 * Returns null rather than guessing.
 */
export function matchShipment(
  projection: DarbShipmentProjection,
  index: OrderIndex,
): { orderId: string; matchedBy: MatchedBy } | null {
  const byId = index.byDarbId.get(projection.darbId);
  if (byId) return { orderId: byId, matchedBy: "internal_id" };

  if (projection.reference) {
    const byRef = index.byReference.get(projection.reference);
    if (byRef) return { orderId: byRef, matchedBy: "reference" };
  }

  if (projection.originalReference) {
    const byOriginal = index.byReference.get(projection.originalReference);
    if (byOriginal) return { orderId: byOriginal, matchedBy: "original_reference" };
  }

  return null;
}

/** Projection → darb_shipments row. */
function shipmentRow(
  p: DarbShipmentProjection,
  carrierId: string,
  orderId: string | null,
  raw: unknown,
  syncedAt: string,
): Record<string, unknown> {
  return {
    darb_id: p.darbId,
    carrier_id: carrierId,
    order_id: orderId,
    reference: p.reference,
    original_reference: p.originalReference,
    status_slug: p.slug,
    raw_status: p.rawStatus || null,
    handler_name: p.handlerName,
    handler_phone: p.handlerPhone,
    handler_account_name: p.handlerAccountName,
    handler_account_phone: p.handlerAccountPhone,
    latest_remark: p.latestRemark,
    latest_remark_at: p.latestRemarkAt,
    cancellation_cause: p.cancellationCause,
    delayed_until: p.delayedUntil,
    cancel_count: p.cancelCount,
    resend_count: p.resendCount,
    billed_shipping_amount: p.billedShippingAmount,
    billed_currency: p.billedCurrency,
    shipping_breakdown: p.shippingBreakdown,
    cod_outstanding: p.codOutstanding,
    delivery_withdrawal_at: p.deliveryWithdrawalAt,
    sales_withdrawal_at: p.salesWithdrawalAt,
    to_city: p.toCity,
    to_area: p.toArea,
    to_address: p.toAddress,
    to_branch_group: p.toBranchGroup,
    to_zone_code: p.toZoneCode,
    group_reference: p.groupReference,
    service_title: p.serviceTitle,
    priority: p.priority,
    notes: p.notes,
    attachments: p.attachments,
    completed_at: p.completedAt,
    carrier_created_at: p.createdAt,
    carrier_updated_at: p.updatedAt,
    latest_event_at: p.latestEventAt,
    latest_comment: p.latestComment,
    latest_comment_at: p.latestCommentAt,
    comment_count: p.commentCount,
    raw,
    last_synced_at: syncedAt,
  };
}

// ── The cycle ────────────────────────────────────────────────────────

export async function runDarbSyncCycle(
  deps: DarbSyncDeps,
  options: {
    carrierId: string;
    pageSize?: number;
    /** ISO timestamp — stop once a page holds nothing updated after this. */
    since?: string | null;
    source?: DarbSyncLogEntry["source"];
  },
): Promise<DarbSyncResult> {
  const pageSize = options.pageSize ?? DARB_PAGE_SIZE;
  const source = options.source ?? "cron";
  const result: DarbSyncResult = {
    carrierId: options.carrierId,
    pagesFetched: 0,
    shipmentsSeen: 0,
    shipmentsUpserted: 0,
    eventsInserted: 0,
    commentsInserted: 0,
    ordersMatched: 0,
    ordersPromoted: 0,
    stoppedEarly: false,
    status: "succeeded",
    errorMessage: null,
  };

  let index: OrderIndex;
  try {
    index = await deps.loadOrderIndex(options.carrierId);
  } catch (err) {
    result.status = "failed";
    result.errorMessage = `loadOrderIndex: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  const syncedAt = new Date().toISOString();
  let offsets = planPages(null, pageSize);
  let totalKnown = false;

  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];

    let page: { records: Array<Record<string, unknown>>; totalCount: number | null };
    try {
      page = await deps.fetchPage(options.carrierId, offset, pageSize);
    } catch (err) {
      result.status = "failed";
      result.errorMessage = `fetchPage(offset=${offset}): ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
    result.pagesFetched += 1;

    // Expand the plan once the server tells us how many shipments exist.
    if (!totalKnown && page.totalCount !== null) {
      offsets = planPages(page.totalCount, pageSize);
      totalKnown = true;
    }

    const shipmentRows: Array<Record<string, unknown>> = [];
    const eventRows: Array<Record<string, unknown>> = [];
    const commentRows: Array<Record<string, unknown>> = [];
    const promotions: Array<{ orderId: string; p: DarbShipmentProjection }> = [];
    let newestOnPage: string | null = null;

    for (const raw of page.records) {
      const p = projectDarbShipment(raw);
      if (!p) continue; // no _id — unaddressable, and a junk mirror row helps nobody
      result.shipmentsSeen += 1;

      if (p.updatedAt && (newestOnPage === null || p.updatedAt > newestOnPage)) {
        newestOnPage = p.updatedAt;
      }

      const match = matchShipment(p, index);
      const orderId = match?.orderId ?? null;

      shipmentRows.push(shipmentRow(p, options.carrierId, orderId, raw, syncedAt));

      for (const c of projectDarbConversation(p.darbId, raw)) {
        commentRows.push({
          darb_id: c.darbId,
          order_id: orderId,
          message_id: c.messageId,
          message: c.message,
          author_name: c.authorName,
          author_phone: c.authorPhone,
          posted_at: c.postedAt,
        });
      }

      for (const e of projectDarbTimeline(p.darbId, raw)) {
        eventRows.push({
          darb_id: e.darbId,
          order_id: orderId,
          event_id: e.eventId,
          type: e.type,
          description_ar: e.descriptionAr,
          description_en: e.descriptionEn,
          remarks: e.remarks,
          actor_id: e.actorId,
          actor_name: e.actorName,
          actor_phone: e.actorPhone,
          account_phone: e.accountPhone,
          occurred_at: e.occurredAt,
        });
      }

      // A status string we don't recognize is a vendor change we need to see.
      // Log it; never throw, and never write a null slug over a good one.
      if (p.slug === null && p.rawStatus.length > 0) {
        await deps
          .writeLog({
            carrier_code: "darb_assabil",
            source,
            tracking_number: p.reference,
            carrier_status_raw: p.rawStatus,
            order_id: orderId,
            outcome: "ignored",
            outcome_reason: `unknown_darb_status:${p.rawStatus}`,
            raw_body: { rawStatus: p.rawStatus, darbId: p.darbId },
          })
          .catch(() => {
            /* forensic only — never fail a sweep on a log write */
          });
      }

      if (orderId) {
        result.ordersMatched += 1;
        promotions.push({ orderId, p });
      }
    }

    if (shipmentRows.length > 0) {
      try {
        result.shipmentsUpserted += await deps.upsertShipments(shipmentRows);
      } catch (err) {
        result.status = "failed";
        result.errorMessage = `upsertShipments: ${err instanceof Error ? err.message : String(err)}`;
        return result;
      }
    }

    if (eventRows.length > 0) {
      try {
        result.eventsInserted += await deps.insertTimelineEvents(eventRows);
      } catch (err) {
        // History is additive; losing it degrades the run but must not discard
        // the shipment mirror we already wrote.
        result.status = "partial";
        result.errorMessage = `insertTimelineEvents: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (commentRows.length > 0) {
      try {
        result.commentsInserted += await deps.insertConversation(commentRows);
      } catch (err) {
        // Same reasoning as the timeline: additive history, must not discard the
        // shipment mirror already written.
        result.status = "partial";
        result.errorMessage = `insertConversation: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    for (const { orderId, p } of promotions) {
      try {
        const res = await deps.promoteStatus({
          orderId,
          slug: p.slug,
          reference: p.reference,
        });
        if (res.promoted) result.ordersPromoted += 1;
      } catch (err) {
        result.status = "partial";
        result.errorMessage = `promoteStatus(${orderId}): ${err instanceof Error ? err.message : String(err)}`;
        await deps
          .writeLog({
            carrier_code: "darb_assabil",
            source,
            tracking_number: p.reference,
            carrier_status_raw: p.rawStatus,
            order_id: orderId,
            outcome: "error",
            outcome_reason: err instanceof Error ? err.message : String(err),
            raw_body: null,
          })
          .catch(() => {});
      }
    }

    // Delta sweep: pages arrive newest-updated-first, so once a whole page is
    // older than the watermark there is nothing newer further down.
    if (options.since && newestOnPage !== null && newestOnPage <= options.since) {
      result.stoppedEarly = true;
      break;
    }
  }

  return result;
}

// ============================================================
// Production wiring — real Supabase + real carrier HTTP.
// ============================================================

export function buildDarbSyncDeps(
  admin: SupabaseClient,
  configByCarrierId: Map<string, CarrierConfig>,
  source: DarbSyncLogEntry["source"] = "cron",
): DarbSyncDeps {
  return {
    fetchPage: async (carrierId, offset, limit) => {
      const config = configByCarrierId.get(carrierId);
      if (!config) throw new Error(`no carrier config for ${carrierId}`);
      return fetchDarbShipmentPage(config, { offset, limit });
    },

    loadOrderIndex: async (carrierId) => {
      const { data, error } = await admin
        .from("orders")
        .select("id, tracking_number, carrier_extra")
        .eq("carrier_id", carrierId);
      if (error) throw new Error(`loadOrderIndex: ${error.message}`);
      const rows = (data ?? []) as Array<{
        id: string;
        tracking_number: string | null;
        carrier_extra: Record<string, unknown> | null;
      }>;
      return buildOrderIndex(
        rows.map((r) => ({
          id: r.id,
          tracking_number: r.tracking_number,
          darb_internal_id:
            typeof r.carrier_extra?.darb_assabil_id === "string"
              ? r.carrier_extra.darb_assabil_id
              : null,
        })),
      );
    },

    upsertShipments: async (rows) => {
      const { error } = await admin
        .from("darb_shipments")
        .upsert(rows, { onConflict: "darb_id" });
      if (error) throw new Error(error.message);
      return rows.length;
    },

    insertTimelineEvents: async (rows) => {
      // Append-only: ignoreDuplicates keeps re-sync idempotent WITHOUT updating
      // an existing row. Never switch this to a true upsert.
      const { error } = await admin
        .from("darb_timeline_events")
        .upsert(rows, { onConflict: "darb_id,event_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return rows.length;
    },

    insertConversation: async (rows) => {
      // Append-only, same as the timeline — ignoreDuplicates, never a true upsert.
      const { error } = await admin
        .from("darb_conversation")
        .upsert(rows, { onConflict: "darb_id,message_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      return rows.length;
    },

    promoteStatus: async ({ orderId, slug, reference }) => {
      const { data, error } = await admin.rpc("promote_darb_status", {
        p_order_id: orderId,
        p_slug: slug,
        p_reference: reference,
        p_synced_at: new Date().toISOString(),
        p_actor_id: null,
      });
      if (error) throw new Error(error.message);
      return { promoted: Boolean((data as { promoted?: boolean } | null)?.promoted) };
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
