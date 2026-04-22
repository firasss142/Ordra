export interface QueueOrder {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
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
  created_at: string;
  assigned_at: string;
}
