// Shared types for the storefront -> OMS product/city resolvers.
//
// Each resolver is split into a pure decision helper (DB-free, deterministic,
// unit-testable) and a thin IO wrapper that does the Supabase reads — the same
// split as auto-assignment.ts / auto-assignment-orchestrator.ts.

/**
 * How confidently a webhook field resolved to an OMS entity. Ordered worst
 * to best by `mappingStatusRank`. The order's overall `mapping_status` is the
 * worst of its product and city outcomes.
 *   mapped       — resolved via an explicit mapping row or an exact id/sku key
 *   needs_review — resolved by a weak/ambiguous path (name match) — verify it
 *   unmatched    — could not be resolved at all
 */
export type MappingStatus = "mapped" | "needs_review" | "unmatched";

/** How a product was resolved — drives the MappingStatus. */
export type ProductMatchMethod =
  | "mapping" // storefront_product_mappings hit (strongest)
  | "sku" // products.sku exact match
  | "name" // products.name ILIKE — fragile, needs review
  | "none"; // no match

/** How a city was resolved — drives the MappingStatus. */
export type CityMatchMethod =
  | "external_id" // external_city_mappings hit (strongest)
  | "name" // cities.name / name_ar normalized match
  | "market_mismatch" // mapping found but resolved city is in another market
  | "none"; // no match

export interface ProductResolution {
  product_id: string | null;
  product_variant_id: string | null;
  match_method: ProductMatchMethod;
}

export interface CityResolution {
  city_id: string | null;
  dexpress_state_id: number | null;
  match_method: CityMatchMethod;
}

const STATUS_RANK: Record<MappingStatus, number> = {
  unmatched: 0,
  needs_review: 1,
  mapped: 2,
};

/** Numeric rank for comparing two MappingStatus values (lower = worse). */
export function mappingStatusRank(status: MappingStatus): number {
  return STATUS_RANK[status];
}

/** The worse (lower-ranked) of two mapping statuses. */
export function worstMappingStatus(
  a: MappingStatus,
  b: MappingStatus,
): MappingStatus {
  return mappingStatusRank(a) <= mappingStatusRank(b) ? a : b;
}

/** Maps a product match method to its contributed MappingStatus. */
export function productMatchStatus(method: ProductMatchMethod): MappingStatus {
  switch (method) {
    case "mapping":
    case "sku":
      return "mapped";
    case "name":
      return "needs_review";
    case "none":
      return "unmatched";
  }
}

/** Maps a city match method to its contributed MappingStatus. */
export function cityMatchStatus(method: CityMatchMethod): MappingStatus {
  switch (method) {
    case "external_id":
      return "mapped";
    case "name":
      return "needs_review";
    case "market_mismatch":
      // A mapping exists but points at the wrong market — never silently
      // accept it; surface it for a human.
      return "needs_review";
    case "none":
      return "unmatched";
  }
}
