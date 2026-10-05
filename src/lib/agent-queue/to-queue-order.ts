import type { QueueOrder } from "@/types/queue";
import { NO_SIBLINGS } from "@/lib/agent-queue/stable-orders";

/**
 * The single gate between the wire and QueueOrder. Anything not mapped here is
 * invisible to QueueList / OrderCard / QueueStatusPill, however faithfully the
 * server sent it — so a missing key is a silent, permanent data loss rather
 * than a crash. Exported for the key-coverage test that guards exactly that.
 */
export function toQueueOrder(raw: Record<string, unknown>): QueueOrder {
  return {
    id: raw.id as string,
    status: raw.status as string,
    customer_name: (raw.customer_name as string) ?? "",
    customer_phone: (raw.customer_phone as string) ?? "",
    customer_address: (raw.customer_address as string | null) ?? null,
    customer_city: (raw.customer_city as string) ?? "",
    product_name: (raw.product_name as string) ?? "",
    // The catalog name the route resolved from products.name. OrderCard reads
    // `product_display_name || product_name`, so omitting this made the || fall
    // through to the raw storefront SKU on every row — while every manager
    // surface showed the resolved name for the same order.
    product_display_name: (raw.product_display_name as string | null) ?? null,
    variant_label: (raw.variant_label as string) ?? "",
    quantity: (raw.quantity as number) ?? 1,
    product_image_url: (raw.product_image_url as string | null) ?? null,
    carrier_id: (raw.carrier_id as string | null) ?? null,
    carrier_code: (raw.carrier_code as string | null) ?? null,
    carrier_name: (raw.carrier_name as string | null) ?? null,
    carrier_accent_color: (raw.carrier_accent_color as string | null) ?? null,
    carrier_logo_url: (raw.carrier_logo_url as string | null) ?? null,
    carrier_account_label: (raw.carrier_account_label as QueueOrder["carrier_account_label"]) ?? null,
    total_price: (raw.total_price as number) ?? 0,
    currency: (raw.currency as string) ?? "TND",
    market_id: (raw.market_id as string | null) ?? null,
    attempt_count: (raw.attempts_count as number) ?? (raw.attempt_count as number) ?? 0,
    callback_time: (raw.callback_scheduled_at as string | null) ?? null,
    scheduled_dispatch_at: (raw.scheduled_dispatch_at as string | null) ?? null,
    scheduled_dispatch_auto: Boolean(raw.scheduled_dispatch_auto),
    customer_note: (raw.customer_note as string | null) ?? null,
    customer_phone_2: (raw.customer_phone_2 as string | null) ?? null,
    created_at: raw.created_at as string,
    assigned_at: (raw.assigned_at as string) ?? (raw.created_at as string),
    last_action_at: (raw.last_action_at as string | null) ?? null,
    wa_conversation: Boolean(raw.wa_conversation),
    wa_unread: (raw.wa_unread as number) ?? 0,
    repeat_kind: (raw.repeat_kind as QueueOrder["repeat_kind"]) ?? "none",
    prior_order_count: (raw.prior_order_count as number) ?? 0,
    prior_lead_count: (raw.prior_lead_count as number) ?? 0,
    prior_rejected_count: (raw.prior_rejected_count as number) ?? 0,
    prior_delivered_count: (raw.prior_delivered_count as number) ?? 0,
    prior_returned_count: (raw.prior_returned_count as number) ?? 0,
    external_id: (raw.external_id as string | null) ?? null,
    last_known_address: (raw.last_known_address as string | null) ?? null,
    rejection_reason: (raw.rejection_reason as string | null) ?? null,
    rejection_subreason: (raw.rejection_subreason as string | null) ?? null,
    rejection_note: (raw.rejection_note as string | null) ?? null,
    is_potential_duplicate: Boolean(raw.is_potential_duplicate),
    duplicate_count: (raw.duplicate_count as number) ?? 0,
    // NO_SIBLINGS rather than a fresh []: a new array each pass would make
    // sameQueueOrders report a change on every single row, every render.
    duplicate_siblings:
      (raw.duplicate_siblings as QueueOrder["duplicate_siblings"]) ?? NO_SIBLINGS,
    has_uploaded_sibling: Boolean(raw.has_uploaded_sibling),
    is_duplicate_anchor: Boolean(raw.is_duplicate_anchor),
    tracking_number: (raw.tracking_number as string | null) ?? null,
    carrier_barcode_deleted_at:
      (raw.carrier_barcode_deleted_at as string | null) ?? null,
    dexpress_status_slug: (raw.dexpress_status_slug as string | null) ?? null,
    dexpress_status_synced_at:
      (raw.dexpress_status_synced_at as string | null) ?? null,
    dexpress_status_accepted:
      typeof raw.dexpress_status_accepted === "boolean"
        ? (raw.dexpress_status_accepted as boolean)
        : null,
    carrier_status_slug: (raw.carrier_status_slug as string | null) ?? null,
    carrier_status_synced_at:
      (raw.carrier_status_synced_at as string | null) ?? null,
  };
}
