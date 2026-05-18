// Shape enforced for browser-originated (auth_mode = 'uuid_only') webhooks.
// HMAC-authenticated storefronts continue to use their adapter's own validation.
import { isRecord } from "./payload-guards";

export type UuidOnlyPayloadValidation =
  | { ok: true }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/**
 * An optional external identifier (city_id, route_id) is valid when it is
 * absent/null, an integer, or a string that parses to an integer. Anything
 * else (float, boolean, object, non-numeric string) is malformed and should
 * be rejected at the door rather than reaching the resolver.
 */
function isOptionalIntegerId(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "number") return Number.isInteger(v);
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 && Number.isInteger(Number(trimmed));
  }
  return false;
}

export function validateUuidOnlyPayload(payload: unknown): UuidOnlyPayloadValidation {
  if (!isRecord(payload)) {
    return { ok: false, error: "Payload must be a JSON object" };
  }

  const customer = payload.customer;
  if (!isRecord(customer)) {
    return { ok: false, error: "Missing customer object" };
  }
  for (const field of ["name", "phone", "city", "address"] as const) {
    if (!isNonEmptyString(customer[field])) {
      return { ok: false, error: `customer.${field} must be a non-empty string` };
    }
  }
  // city_id / route_id are optional carrier-routing hints. When present they
  // must be integer-like; the city resolver still falls back to the city
  // string when they are absent.
  for (const field of ["city_id", "route_id"] as const) {
    if (!isOptionalIntegerId(customer[field])) {
      return {
        ok: false,
        error: `customer.${field} must be an integer or numeric string when present`,
      };
    }
  }

  const product = payload.product;
  if (!isRecord(product)) {
    return { ok: false, error: "Missing product object" };
  }
  if (typeof product.variant_id !== "number") {
    return { ok: false, error: "product.variant_id must be a number" };
  }
  if (!isPositiveInteger(product.quantity)) {
    return { ok: false, error: "product.quantity must be a positive integer" };
  }

  return { ok: true };
}
