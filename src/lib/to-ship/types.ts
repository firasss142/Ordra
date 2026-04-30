import type { OrderStatus } from "@/types/order-status";

export interface ToShipRow {
  id: string;
  customer_name: string;
  customer_city: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: OrderStatus;
  current_stock: number;
  low_stock_threshold: number;
  scheduled_at: string | null;
  scheduled_auto: boolean;
  scheduled_carrier_id: string | null;
}

export type Grouping = "city" | "product" | "carrier" | "schedule" | "status" | "none";
export type Subgrouping = "city" | "none";

export interface ToShipFilters {
  productId: string | null;
  city: string | null;
}

export interface Group {
  key: string;
  label: string;
  rows: ToShipRow[];
  totalQuantity: number;
  subgroups?: Group[];
}

export interface ScheduledSummary {
  overdue: number;
  today: number;
  todayAuto: number;
  tomorrow: number;
  later: number;
}
