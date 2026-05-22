import type { RepeatKind } from "@/lib/customer-history/classify";
import type { SiblingOrder } from "@/lib/duplicate-orders/detect";

export interface QueueOrder {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string;
  product_name: string;
  variant_label: string;
  quantity: number;
  /** Product thumbnail URL (joined from products.image_url), null when unset. */
  product_image_url: string | null;
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
  repeat_kind: RepeatKind;
  prior_order_count: number;
  prior_lead_count: number;
  prior_rejected_count: number;
  last_known_address: string | null;
  rejection_reason: string | null;
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
}
