/**
 * Resolves the product name to DISPLAY for an order.
 *
 * orders.product_name is the untouched external string copied from the
 * storefront webhook or the Google Sheet — it is an audit record, it feeds the
 * mapping engine, and it is never rewritten. When an order has been resolved to
 * an internal catalog product (orders.product_id) we prefer products.name;
 * otherwise we fall back to the external string so nothing ever renders blank.
 */

/** A PostgREST to-one embed: object, single-element array, or null. */
type Embedded<T> = T | T[] | null | undefined;

/**
 * PostgREST returns a to-one embed as an object in some cases and as an array
 * in others, so every call site would otherwise repeat this unwrap.
 */
export function unwrapEmbed<T>(value: Embedded<T>): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export interface OrderNameSource {
  /** Untouched external string. Column is NOT NULL but tolerate bad data. */
  product_name?: string | null;
  /** Embedded products row, present when the select included products(name). */
  product?: Embedded<{ name?: string | null }>;
}

/**
 * Returns "" rather than null in the worst case so this stays drop-in
 * compatible with the unguarded `{order.product_name}` render sites.
 */
export function resolveProductDisplayName(row: OrderNameSource): string {
  const internal = unwrapEmbed(row.product)?.name;
  if (typeof internal === "string" && internal.trim() !== "") {
    return internal;
  }
  const external = row.product_name;
  if (typeof external === "string" && external.trim() !== "") {
    return external;
  }
  return "";
}

export interface VariantNameSource {
  variant_label?: string | null;
  product_variant?: Embedded<{ label?: string | null }>;
}

/**
 * Returns null (not "") when absent, because every variant render site is
 * already conditional — `{order.variant_label && ...}` — and null matches the
 * existing column type.
 */
export function resolveVariantDisplayLabel(row: VariantNameSource): string | null {
  const internal = unwrapEmbed(row.product_variant)?.label;
  if (typeof internal === "string" && internal.trim() !== "") {
    return internal;
  }
  const external = row.variant_label;
  if (typeof external === "string" && external.trim() !== "") {
    return external;
  }
  return null;
}
