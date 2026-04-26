import type { RepeatKind } from "@/lib/customer-history/classify";

export interface QueueOrder {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string;
  product_name: string;
  variant_label: string;
  total_price: number;
  currency: string;
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
}
