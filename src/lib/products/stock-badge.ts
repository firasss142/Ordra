import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Stock pill descriptor, shared by the receipt card, the add-product picker
 * and the agent product sheet. Returns data, not JSX, so the caller owns the
 * translation namespace and the markup.
 *
 * The default threshold of 5 is what the two original call sites hardcoded —
 * neither of them loads `products.low_stock_threshold`. The product sheet does
 * load it and passes the real value, so it can disagree with the receipt card
 * for products configured with a different threshold. That is intentional:
 * the sheet is the authoritative view.
 */
export interface StockBadgeDescriptor {
  tone: BadgeTone;
  /** Translation key under `orders.detail`. */
  key: "inStock" | "outOfStock" | "stockLeft";
  /** Interpolation count, only set for `stockLeft`. */
  count?: number;
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function stockBadge(
  stock: number,
  lowThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): StockBadgeDescriptor {
  if (stock <= 0) return { tone: "critical", key: "outOfStock" };
  if (stock <= lowThreshold) return { tone: "warning", key: "stockLeft", count: stock };
  return { tone: "success", key: "inStock" };
}
