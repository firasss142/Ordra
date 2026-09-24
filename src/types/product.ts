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

/** Tone of the pinned must-know shown to agents on the order. */
export type AgentBriefTone = "info" | "warning" | "critical";

export interface Product {
  id: string;
  market_id: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost?: number;
  default_price?: number | null;
  low_stock_threshold: number;
  initial_stock?: number;
  current_stock: number;
  damaged_return_count: number;
  is_active: boolean;
  image_url?: string | null;
  /** Pinned must-know for confirmation agents. Always visible on the order. */
  agent_brief?: string | null;
  agent_brief_tone?: AgentBriefTone;
  /** Internal selling notes shown in the product sheet drawer. */
  agent_notes?: string | null;
  agent_content_updated_at?: string | null;
  agent_content_updated_by?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Two kinds, and the difference is load-bearing.
 *
 * `attribute` — a physically different item (Petit / Moyen / Grand). It holds
 * its OWN stock, cost and SKU, and is what a stock movement points at.
 * `pack` — a way of selling the same item ("Pack 2"). It holds no stock; it
 * consumes `quantity` units of the attribute variant chosen on the call.
 *
 * Keeping them on two axes rather than one matrix is why a fourth size costs
 * one row, not twelve.
 */
export type ProductVariantKind = "attribute" | "pack";

/** What `display_price` is quoting — the whole tier, or one unit of it. */
export type VariantPriceBasis = "pack" | "unit";

export interface ProductVariant {
  id: string;
  product_id: string;
  /** Denormalised from the parent product, trigger-maintained, immutable. */
  market_id: string;
  kind: ProductVariantKind;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
  /** Unique per market, in ONE namespace shared with `products.sku`. */
  sku?: string | null;
  /** Attribute variants only — a pack inherits its parent's cost. */
  unit_cogs?: number;
  /** Market total for this variant; ventilated per site in product_site_stock. */
  current_stock?: number;
  damaged_return_count?: number;
  /** Physical units released per tier sold. Pack variants only. */
  units_per_pack?: number;
  price_basis?: VariantPriceBasis;
  /** One-line upsell/pack note for this quantity tier. */
  agent_note?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InventoryLogEntry {
  id: string;
  product_id: string;
  /** Set when the movement belongs to a specific attribute variant. */
  variant_id?: string | null;
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
