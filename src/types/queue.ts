import type { RepeatKind } from "@/lib/customer-history/classify";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

export interface QueueOrder {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string;
  /** Untouched external string from the storefront — audit record. */
  product_name: string;
  /** Internal catalog name (products.name) when the order resolved to one. */
  product_display_name?: string | null;
  variant_label: string;
  quantity: number;
  /** Product thumbnail URL (joined from products.image_url), null when unset. */
  product_image_url: string | null;
  /** The carrier ROW, not the brand — Libya runs two Darb Assabil accounts
   *  under one code, and only the id tells them apart. */
  carrier_id: string | null;
  /** Carrier code (joined from carriers.code), set once a carrier is assigned. Drives the brand logo. */
  carrier_code: string | null;
  /** Carrier display name (joined from carriers.name) — used for the logo's alt/title text. */
  carrier_name: string | null;
  total_price: number;
  currency: string;
  market_id: string | null;
  attempt_count: number;
  callback_time: string | null;
  scheduled_dispatch_at: string | null;
  scheduled_dispatch_auto: boolean;
  customer_note: string | null;
  customer_phone_2: string | null;
  created_at: string;
  assigned_at: string;
  /**
   * When an *agent* last acted on this order — the newest `actor_type='agent'`
   * row in order_history. Null when nobody has acted yet.
   *
   * Deliberately NOT `orders.updated_at`: `trg_orders_updated_at` fires on
   * every write, and the carrier status-sync crons write to these rows, so an
   * order nobody has called in three days would report "5 minutes ago".
   */
  last_action_at: string | null;
  repeat_kind: RepeatKind;
  prior_order_count: number;
  prior_lead_count: number;
  prior_rejected_count: number;
  last_known_address: string | null;
  /** The rejection *group*. The specific reason is `rejection_subreason`. */
  rejection_reason: string | null;
  /** Null on legacy rows and on group `autre`, where the note carries it. */
  rejection_subreason: string | null;
  rejection_note: string | null;
  is_potential_duplicate: boolean;
  duplicate_count: number;
  duplicate_siblings: SiblingOrder[];
  has_uploaded_sibling: boolean;
  /** True only for the newest order in a duplicate group — the one that carries the icon. */
  is_duplicate_anchor: boolean;
  /** Carrier tracking number — set once uploaded, cleared when the reference is deleted. */
  tracking_number: string | null;
  /** When set (with no tracking_number), an uploaded order's carrier reference was deleted. */
  carrier_barcode_deleted_at: string | null;
  /** Cached Dexpress portal status slug. Drives the fermé bucket pill for Dexpress orders. */
  dexpress_status_slug: string | null;
  /** Last successful Dexpress sync timestamp; NULL means never synced. */
  dexpress_status_synced_at: string | null;
  /**
   * Mirrors Dexpress order_accept. FALSE = sitting in /merchant/pending-orders
   * (Dexpress hasn't acknowledged yet); the bucket function then forces
   * 'uploaded' even when the slug looks like a lifecycle state. NULL = never
   * synced / pre-migration row.
   */
  dexpress_status_accepted: boolean | null;
  /**
   * Generic cached carrier status slug (non-Dexpress carriers; currently Darb
   * Assabil). Drives the fermé bucket pill via bucketFor's carrierStatusSlug.
   * Projection only — NEVER drives orders.status / stock / cost / revenue.
   */
  carrier_status_slug: string | null;
  /** Last successful carrier status sync; NULL means never synced. */
  carrier_status_synced_at: string | null;
}
