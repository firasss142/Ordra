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

/**
 * How a city was resolved — drives the MappingStatus.
 *
 * The storefront city is always a value the customer picked from a constrained
 * dropdown whose options mirror our destination tables (cities for Tunisia,
 * dexpress_states for Libya), so an exact normalized name match is
 * authoritative. There is no fuzzy/typo middle ground — a name either is a
 * member of the destination table or it isn't.
 */
export type CityMatchMethod =
  | "name" // exact normalized match against the market's destination table
  | "none"; // no match — the dropdown value isn't in our destination table

export interface ProductResolution {
  product_id: string | null;
  product_variant_id: string | null;
  match_method: ProductMatchMethod;
}

export interface CityResolution {
  city_id: string | null;
  dexpress_state_id: number | null;
  /**
   * Libya primary path (Darb Assabil). When the city resolves to a single-area
   * Darb destination, this is that pair's row id. For a multi-area Darb city the
   * area is chosen at dispatch, so the id stays null but `darb_city` is set —
   * still a confident `name` match.
   */
  darb_destination_id: number | null;
  /** Canonical Darb city (snapshot for the order's customer_city), or null. */
  darb_city: string | null;
  /** Resolved Darb area for a single-area city, or null when undecided. */
  darb_area: string | null;
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

/**
 * Maps a city match method to its contributed MappingStatus.
 *
 * A name match is authoritative (the customer picked the value from a
 * constrained dropdown), so it resolves to `mapped`. No match means the
 * dropdown value isn't in our destination table — `unmatched`, flagged for a
 * human to bind the order to an existing destination.
 */
export function cityMatchStatus(method: CityMatchMethod): MappingStatus {
  switch (method) {
    case "name":
      return "mapped";
    case "none":
      return "unmatched";
  }
}
