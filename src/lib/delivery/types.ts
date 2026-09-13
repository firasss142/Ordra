/**
 * Types for the post-upload delivery worklist ("Suivi livraison").
 * The row mirrors public.get_delivery_worklist column for column, plus the
 * order's items, which the route joins on (the RPC stays one query per market).
 * See docs/delivery-worklist.md.
 */

export type Bucket = "returning" | "act_now" | "waiting_customer" | "waiting_carrier" | "done";

export type RiskReason = "repeat_risk" | "high_value" | "low_zone";

export interface WorklistItem {
  product_name: string | null;
  variant_label: string | null;
  quantity: number;
}

export interface WorklistRow {
  order_id: string;
  external_id: string | null;
  status: string;
  bucket: Bucket;
  reason_codes: string[];
  hours_on_status: number | null;
  next_action_at: string | null;
  is_risky: boolean;
  risk_reasons: string[];
  total_price: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  customer_city: string | null;
  customer_address: string | null;
  assigned_to: string | null;
  agent_name: string | null;
  tracking_number: string | null;
  carrier_id: string | null;
  carrier_status_slug: string | null;
  latest_remark: string | null;
  latest_remark_at: string | null;
  remark_class: string | null;
  delayed_until: string | null;
  resend_count: number | null;
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  handler_account_phone: string | null;
  to_branch_group: string | null;
  latest_event_at: string | null;
  customer_orders_count: number | null;
  customer_delivered_count: number | null;
  customer_returned_count: number | null;
  customer_rejected_count: number | null;
  customer_risk_class: string | null;
  last_action_at: string | null;
  last_action_type: string | null;
  last_action_outcome: string | null;
  last_action_note: string | null;
  has_open_task: boolean;
  terminal_at: string | null;
  created_at: string | null;
  carrier_name: string | null;
  items: WorklistItem[];
}

export interface WorklistResponse {
  rows: WorklistRow[];
  generated_at: string;
}

/** One entry of the merged parcel timeline in the detail view. */
export type TimelineSource = "action" | "carrier" | "remark" | "order";

export interface TimelineEntry {
  id: string;
  source: TimelineSource;
  at: string;
  /** Machine label: an order status, an action type, a Darb event type. */
  kind: string;
  /** Free text as written by whoever produced it (courier, agent, Darb). */
  text: string | null;
  outcome: string | null;
  actor: string | null;
  /** True for rows written by the person looking at the page. */
  mine: boolean;
}

/** get_delivery_agent_scorecard — the "85 % livraison 30 j · 6 sauvées" pill. */
export interface DeliveryScorecard {
  delivered: number;
  returned: number;
  delivery_rate: number | null;
  saved: number;
  window_days: number;
}

export interface DeliveryOrderDetail {
  timeline: TimelineEntry[];
}
