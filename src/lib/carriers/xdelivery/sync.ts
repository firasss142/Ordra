/**
 * X-Delivery status sync — one path for the webhook and the 10-minute poll.
 *
 * Statuses are applied by the `promote_carrier_status` RPC (rank-guarded, never
 * `returned`, delivered stays delivered). This module only maps, batches and
 * logs. Every update leaves a `carrier_event_log` row: the poll answer silently
 * drops barcodes it does not know, so a parcel that stops being reported must
 * leave a trace on our side.
 */

import { mapXDeliveryStatus } from "../xdelivery-statuses";
import type { OrderStatus } from "@/types/order-status";

export interface XDeliveryUpdate {
  /** The webhook sends a number; the poll a string. Always stringified here. */
  barcode: string | number;
  status: string;
  motif?: string | null;
}

export interface XDeliveryLogEntry {
  carrier_code: "xdelivery";
  source: "webhook" | "poll";
  tracking_number: string;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error";
  outcome_reason: string | null;
  raw_body: unknown;
}

export interface PromoteResult {
  promoted: boolean;
  status: string;
  conflict: string | null;
}

export interface XDeliverySyncDeps {
  /** Orders of the X-Delivery account(s) in scope, by tracking number. */
  findOrders: (barcodes: string[]) => Promise<{ order_id: string; tracking_number: string }[]>;
  promote: (input: {
    orderId: string;
    target: OrderStatus | null;
    slug: string;
    note: string;
  }) => Promise<PromoteResult>;
  writeLog: (entry: XDeliveryLogEntry) => Promise<void>;
}

export interface XDeliverySyncResult {
  processed: number;
  ignored: number;
  errored: number;
  /** Order ids X-Delivery turned into a return after delivery (decision 7). */
  conflicts: string[];
}

async function log(deps: XDeliverySyncDeps, entry: XDeliveryLogEntry): Promise<void> {
  try {
    await deps.writeLog(entry);
  } catch {
    // forensic only: a log failure never changes what happened to the order
  }
}

export async function applyXDeliveryUpdates(
  updates: XDeliveryUpdate[],
  source: "webhook" | "poll",
  deps: XDeliverySyncDeps,
): Promise<XDeliverySyncResult> {
  const result: XDeliverySyncResult = { processed: 0, ignored: 0, errored: 0, conflicts: [] };
  if (updates.length === 0) return result;

  const clean = updates.map((u) => ({ ...u, barcode: String(u.barcode).trim() }));
  const orders = await deps.findOrders([...new Set(clean.map((u) => u.barcode))]);
  const byBarcode = new Map(orders.map((o) => [o.tracking_number, o.order_id]));

  for (const u of clean) {
    const base = {
      carrier_code: "xdelivery" as const,
      source,
      tracking_number: u.barcode,
      carrier_status_raw: u.status ?? null,
      raw_body: u,
    };
    const mapping = mapXDeliveryStatus(u.status, u.motif);
    const orderId = byBarcode.get(u.barcode) ?? null;

    if (!mapping) {
      result.ignored++;
      await log(deps, { ...base, order_id: orderId, outcome: "ignored", outcome_reason: `unknown_status:${u.status}` });
      continue;
    }
    if (!orderId) {
      result.ignored++;
      await log(deps, { ...base, order_id: null, outcome: "ignored", outcome_reason: "order_not_found" });
      continue;
    }

    try {
      const r = await deps.promote({ orderId, target: mapping.target, slug: mapping.slug, note: mapping.note });
      if (r.conflict) {
        result.ignored++;
        result.conflicts.push(orderId);
        await log(deps, { ...base, order_id: orderId, outcome: "ignored", outcome_reason: r.conflict });
      } else {
        result.processed++;
        await log(deps, {
          ...base,
          order_id: orderId,
          outcome: "processed",
          outcome_reason: r.promoted ? null : "no_status_change",
        });
      }
    } catch (err) {
      result.errored++;
      await log(deps, {
        ...base,
        order_id: orderId,
        outcome: "error",
        outcome_reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

// ── Poll ──────────────────────────────────────────────────────────

export interface OpenXDeliveryParcel {
  order_id: string;
  tracking_number: string;
  carrier_id: string;
}

export interface XDeliveryPollDeps extends XDeliverySyncDeps {
  fetchOpenParcels: () => Promise<OpenXDeliveryParcel[]>;
  /** `POST /parcels/status` for one account. Unknown barcodes are absent from the answer. */
  fetchStatuses: (
    carrierId: string,
    barcodes: string[],
  ) => Promise<{ barcode: string; status: string; motif?: string | null }[]>;
}

export interface XDeliveryPollResult {
  carrierCode: "xdelivery";
  polled: number;
  processed: number;
  ignored: number;
  errored: number;
}

const BATCH = 100;

export async function pollXDelivery(deps: XDeliveryPollDeps): Promise<XDeliveryPollResult> {
  const parcels = await deps.fetchOpenParcels();
  const out: XDeliveryPollResult = {
    carrierCode: "xdelivery",
    polled: parcels.length,
    processed: 0,
    ignored: 0,
    errored: 0,
  };
  if (parcels.length === 0) return out;

  const byAccount = new Map<string, OpenXDeliveryParcel[]>();
  for (const p of parcels) {
    const list = byAccount.get(p.carrier_id) ?? [];
    list.push(p);
    byAccount.set(p.carrier_id, list);
  }

  for (const [carrierId, list] of byAccount) {
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const barcodes = chunk.map((p) => p.tracking_number);
      let answer: { barcode: string; status: string; motif?: string | null }[];
      try {
        answer = await deps.fetchStatuses(carrierId, barcodes);
      } catch (err) {
        out.errored += chunk.length;
        for (const p of chunk) {
          await log(deps, {
            carrier_code: "xdelivery",
            source: "poll",
            tracking_number: p.tracking_number,
            carrier_status_raw: null,
            order_id: p.order_id,
            outcome: "error",
            outcome_reason: err instanceof Error ? err.message : String(err),
            raw_body: null,
          });
        }
        continue;
      }

      const seen = new Set(answer.map((a) => String(a.barcode)));
      for (const p of chunk) {
        if (seen.has(p.tracking_number)) continue;
        out.ignored++;
        await log(deps, {
          carrier_code: "xdelivery",
          source: "poll",
          tracking_number: p.tracking_number,
          carrier_status_raw: null,
          order_id: p.order_id,
          outcome: "ignored",
          outcome_reason: "not_returned_by_carrier",
          raw_body: null,
        });
      }

      const r = await applyXDeliveryUpdates(answer, "poll", deps);
      out.processed += r.processed;
      out.ignored += r.ignored;
      out.errored += r.errored;
    }
  }
  return out;
}
