/**
 * The prospect worklist's row shape. Built from `leads` as it really is in the
 * database, plus the customer history the API attaches per row
 * (get_customer_history_batch) and the campaign the lead belongs to.
 *
 * Design: prototypes/prospects-v3.html. Model: docs/crm-and-team.md §Prospects.
 *
 * Two columns the old code believed in are deliberately absent: `is_hot` and
 * `has_duplicate` are typed in src/types/lead.ts and filtered by /api/leads,
 * but neither exists in `leads`. Hotness is computed instead — see bucketOf().
 */
import type { LeadSource, LeadStatus } from "@/types/lead";
import type { RepeatKind } from "@/lib/customer-history/classify";

/** The six buckets of the prototype's filter strip, in the order they are shown. */
export type Bucket = "hot" | "callback" | "retry" | "campaign" | "winback" | "converted";

export interface ProspectRow {
  id: string;
  market_id: string;
  status: LeadStatus;
  source: LeadSource;
  /** Where the row sits in the worklist. Derived, never stored — see bucketOf(). */
  bucket: Bucket;

  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;

  /** Only 10 of ~2 000 production leads carry a product; the card hides when null. */
  product_id: string | null;
  product_name: string | null;
  product_price: number | null;
  product_image_url: string | null;
  /** Free text when the agent noted an interest no catalogue entry matches. */
  product_note: string | null;

  notes: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  callback_scheduled_at: string | null;
  converted_order_id: string | null;
  converted_order_ref: string | null;

  campaign_id: string | null;
  campaign_name: string | null;
  /** Campaign offer and script exist only once the 2026-09-14 migration lands. */
  campaign_offer: string | null;
  campaign_script: string | null;

  /** The returned order a win-back lead was born from, and why it came back. */
  source_order_id: string | null;
  source_order_ref: string | null;
  return_reason: string | null;

  /** Customer history, from get_customer_history_batch. */
  repeat_kind: RepeatKind;
  prior_order_count: number;
  prior_delivered_count: number;
  prior_returned_count: number;
  last_known_address: string | null;

  created_at: string;
  updated_at: string;
  /** Last entry in lead_history: what moved this row, and when. */
  last_touch_at: string | null;
}

export interface ProspectsResponse {
  rows: ProspectRow[];
  total: number;
  /**
   * True when the query hit its limit and there are prospects the page is not
   * showing. The surface must say so rather than imply the list is complete.
   */
  truncated: boolean;
  /** The market's hot window in minutes (`lead_hot_window_minutes`, default 60). */
  hot_window_minutes: number;
  generated_at: string;
}
