export type StockMovementReason =
  | "initial_stock"
  | "deposit"
  | "returned"
  | "manual_adjustment"
  | "damaged_writeoff";

export const StockMovementReason = {
  initial_stock: "initial_stock" as const,
  deposit: "deposit" as const,
  returned: "returned" as const,
  manual_adjustment: "manual_adjustment" as const,
  damaged_writeoff: "damaged_writeoff" as const,
};

export interface Product {
  id: string;
  market_id: string;
  name: string;
  sku?: string | null;
  unit_cogs: number;
  packing_cost: number;
  cpl: number;
  confirmation_processing_cost?: number;
  default_price?: number | null;
  low_stock_threshold: number;
  current_stock: number;
  damaged_return_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryLogEntry {
  id: string;
  product_id: string;
  order_id: string | null;
  change: number;
  balance_after: number;
  reason: StockMovementReason;
  note: string | null;
  actor_id: string;
  created_at: string;
}

export function isValidProduct(obj: unknown): obj is Product {
  if (obj === null || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name === "") return false;
  if (typeof p.unit_cogs !== "number" || p.unit_cogs < 0) return false;
  if (typeof p.low_stock_threshold !== "number" || p.low_stock_threshold < 0)
    return false;
  if (typeof p.current_stock !== "number" || p.current_stock < 0) return false;
  return true;
}
