"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DarbTimelineLike } from "@/lib/carriers/darb-shipment-display";

export interface DarbShipmentDetail {
  darb_id: string;
  reference: string | null;
  original_reference: string | null;
  status_slug: string | null;
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  handler_account_phone: string | null;
  latest_remark: string | null;
  latest_remark_at: string | null;
  latest_comment: string | null;
  comment_count: number;
  cancellation_cause: string | null;
  delayed_until: string | null;
  cancel_count: number | null;
  resend_count: number | null;
  billed_shipping_amount: number | null;
  billed_currency: string | null;
  shipping_breakdown: Record<string, number> | null;
  cod_outstanding: number | null;
  delivery_withdrawal_at: string | null;
  completed_at: string | null;
  to_city: string | null;
  to_area: string | null;
  to_address: string | null;
  to_branch_group: string | null;
  service_title: string | null;
  priority: number | null;
  notes: string | null;
  attachments: Array<{ url: string; mimeType: string | null; alt: string | null }>;
  last_synced_at: string;
  carrier_updated_at: string | null;
}

export interface DarbCommentEntry {
  message_id: string;
  message: string;
  author_name: string | null;
  posted_at: string | null;
}

export interface DarbShipmentResponse {
  /** null = the carrier has no record of this shipment. A real state, not an error. */
  shipment: DarbShipmentDetail | null;
  timeline: DarbTimelineLike[];
  comments: DarbCommentEntry[];
}

/**
 * Darb Assabil detail for one order, read from the local mirror.
 *
 * The scheduled sweep keeps the mirror current, so this is a local read — no
 * carrier round-trip on panel open, and it still works while Darb is down.
 * `revalidateOnFocus` is off for the same reason the interval is generous: the
 * underlying data only changes when the sweep runs.
 */
export function useDarbShipment(orderId: string | null, enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<DarbShipmentResponse>(
    enabled && orderId ? `/api/orders/${orderId}/darb-shipment` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );

  return {
    shipment: data?.shipment ?? null,
    timeline: data?.timeline ?? [],
    comments: data?.comments ?? [],
    hasLoaded: !!data,
    isLoading,
    error,
    refresh: mutate,
  };
}
