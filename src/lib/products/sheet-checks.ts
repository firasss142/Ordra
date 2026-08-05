/**
 * Verification checks for the agent product sheet.
 *
 * The sheet is not only a reference card — it is a guard rail. These checks
 * answer "does this order still agree with the catalogue?" using data the
 * system already has, so an agent is warned before they confirm a price that
 * moved, a product that was pulled, or a pack tier that no longer exists.
 *
 * Pure and side-effect free: no I/O, no Supabase, no formatting. The UI maps
 * `code` to a translated string and `severity` to a tone.
 */

export type SheetCheckCode =
  | "unmapped"
  | "product_inactive"
  | "out_of_stock"
  | "variant_inactive"
  | "price_mismatch"
  | "low_stock";

export type SheetCheckSeverity = "critical" | "warning" | "info";

export interface SheetCheck {
  code: SheetCheckCode;
  severity: SheetCheckSeverity;
  /** Interpolation values for the translated message. */
  values?: Record<string, string | number>;
}

export interface SheetCheckOrder {
  product_id: string | null;
  variant_id: string | null;
  unit_price: number;
}

export interface SheetCheckProduct {
  id: string;
  is_active: boolean;
  current_stock: number;
  low_stock_threshold: number;
  default_price: number | null;
}

export interface SheetCheckVariant {
  id: string;
  label: string;
  display_price: number;
  is_active: boolean;
}

const SEVERITY_RANK: Record<SheetCheckSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// Prices are NUMERIC(10,3); anything under half a millime is float noise,
// not a real disagreement.
const PRICE_EPSILON = 0.0005;

export interface CheckOptions {
  /**
   * False when the product being shown is not the one on the order — i.e. the
   * agent is previewing a cross-sell alternative. Comparing that product's
   * price against the order's line price would be meaningless, so the
   * order-relative checks are skipped and only intrinsic ones remain.
   */
  compareToOrder?: boolean;
}

export function checkProductSheet(
  order: SheetCheckOrder,
  product: SheetCheckProduct | null,
  variants: SheetCheckVariant[],
  opts: CheckOptions = {},
): SheetCheck[] {
  const compareToOrder = opts.compareToOrder ?? true;

  // Storefront orders that never resolved to a catalogue product (see
  // orders.mapping_status) have nothing to verify against. Say so explicitly —
  // otherwise the sheet renders blank and the agent cannot tell why.
  if (!product) {
    return [{ code: "unmapped", severity: "warning" }];
  }

  const checks: SheetCheck[] = [];

  if (!product.is_active) {
    checks.push({ code: "product_inactive", severity: "critical" });
  }

  if (product.current_stock <= 0) {
    checks.push({ code: "out_of_stock", severity: "critical" });
  } else if (product.current_stock <= product.low_stock_threshold) {
    checks.push({
      code: "low_stock",
      severity: "warning",
      values: { stock: product.current_stock },
    });
  }

  const orderedVariant =
    compareToOrder && order.variant_id
      ? (variants.find((v) => v.id === order.variant_id) ?? null)
      : null;

  if (orderedVariant && !orderedVariant.is_active) {
    checks.push({
      code: "variant_inactive",
      severity: "warning",
      values: { label: orderedVariant.label },
    });
  }

  // A variant that resolved wins: pack tiers carry their own price. Otherwise
  // fall back to the product default (including when the ordered variant has
  // since been deleted from the catalogue).
  const catalogPrice = orderedVariant ? orderedVariant.display_price : product.default_price;

  // A null or zero catalogue price means "not set", not "free" — there is
  // nothing meaningful to compare against.
  if (compareToOrder && catalogPrice !== null && catalogPrice > 0) {
    if (Math.abs(catalogPrice - order.unit_price) > PRICE_EPSILON) {
      checks.push({
        code: "price_mismatch",
        severity: "warning",
        values: { orderPrice: order.unit_price, catalogPrice },
      });
    }
  }

  return checks.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** The single check the pinned banner should surface, if any. */
export function primaryCheck(checks: SheetCheck[]): SheetCheck | null {
  return checks.find((c) => c.severity !== "info") ?? null;
}
