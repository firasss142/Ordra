export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function getNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  return parseDecimal(obj[key]);
}

export function getRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const v = obj[key];
  return isRecord(v) ? v : undefined;
}

export function getArray(
  obj: Record<string, unknown>,
  key: string,
): unknown[] | undefined {
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}

export function parseDecimal(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.length === 0) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extracts an external storefront identifier (product id, variant id, city
 * id, route id) and normalizes it to a string.
 *
 * Storefronts are inconsistent: Shopify sends ids as strings, Buybox sends
 * variant_id / city_id / route_id as JSON numbers. The OMS persists them as
 * TEXT, so we coerce numeric ids to their plain integer string form (no
 * exponent notation, no trailing decimals). Non-integer or non-finite
 * numbers are treated as malformed — an external id is always an integer or
 * an opaque string.
 */
export function getExternalId(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : undefined;
  }
  return undefined;
}
