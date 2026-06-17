import type { SupabaseClient } from "@supabase/supabase-js";
import type { CityResolution } from "./resolver-types";
import { marketIdToCode } from "@/lib/markets";
import { resolveDarbAny } from "@/lib/carriers/darb-assabil-areas";
import { normalizeCityName } from "./normalize-city";

// Re-export so existing importers of this module (and tests) keep working.
export { normalizeCityName };

/**
 * Resolves a webhook order's destination — name-only, market-aware.
 *
 * The storefront city is always a value the customer picked from a constrained
 * dropdown whose options mirror our destination tables. So resolution is a
 * single stage: normalize `customer_city` and exact-match it against the
 * market's destination table.
 *
 *   - Tunisia: the destination is an OMS city (cities.id → orders.city_id).
 *   - Libya:   Darb Assabil is the PRIMARY carrier and its (city, area)
 *              catalogue is the destination list. We resolve Darb FIRST
 *              (→ orders.darb_destination_id + a canonical city snapshot);
 *              only when Darb does not serve the city do we fall back to the
 *              Dexpress state list (→ orders.dexpress_state_id). At most one of
 *              the three destination columns is set.
 *
 * The destination columns are mutually exclusive on an order, matching the
 * orders PATCH contract (setting one clears the others).
 *
 * An exact normalized match → `name` (authoritative — the value came from a
 * constrained dropdown). No match → `none` (flagged: the dropdown drifted from
 * our destination table; a human binds the order to an existing destination).
 *
 * `customer_address` is free text and is never matched here — it is courier
 * instructions, stored raw on the order.
 *
 * Split like auto-assignment: `decideCityResolution` is the pure decision
 * core, `resolveCity` is the thin IO wrapper. `normalizeCityName` is exported
 * so the handler/UI can normalize consistently.
 */


/**
 * A normalized-name match — discriminated by market kind:
 *   - "city"     → a cities row (Tunisia)
 *   - "darb"     → a Darb Assabil destination (Libya primary). `id`/`area` are
 *                  set for a single-area city; null for a multi-area city whose
 *                  area is chosen at dispatch (still a confident match).
 *   - "dexpress" → a dexpress_states row (Libya fallback)
 */
export type CityNameMatch =
  | { kind: "city"; id: string; market_id: string }
  | { kind: "darb"; id: number | null; city: string; area: string | null }
  | { kind: "dexpress"; id: number };

/** A fully-null destination resolution (no destination set). */
const NO_DESTINATION = {
  city_id: null,
  dexpress_state_id: null,
  darb_destination_id: null,
  darb_city: null,
  darb_area: null,
} as const;

/** Pre-fetched inputs the pure decision core needs. */
export interface CityResolverInput {
  /** True when the storefront's market is Libya (Darb-first, Dexpress fallback). */
  isDexpressMarket: boolean;
  /** The destination matched by normalized-name lookup, or null. */
  nameMatch: CityNameMatch | null;
}

/** Pure, deterministic resolution decision — no IO. */
export function decideCityResolution(input: CityResolverInput): CityResolution {
  if (input.isDexpressMarket) {
    // --- Libya: Darb destination (primary) before Dexpress state (fallback) ---
    if (input.nameMatch && input.nameMatch.kind === "darb") {
      return {
        ...NO_DESTINATION,
        darb_destination_id: input.nameMatch.id,
        darb_city: input.nameMatch.city,
        darb_area: input.nameMatch.area,
        match_method: "name",
      };
    }
    if (input.nameMatch && input.nameMatch.kind === "dexpress") {
      return {
        ...NO_DESTINATION,
        dexpress_state_id: input.nameMatch.id,
        match_method: "name",
      };
    }
    return { ...NO_DESTINATION, match_method: "none" };
  }

  // --- Tunisia: destination is a cities id ---
  if (input.nameMatch && input.nameMatch.kind === "city") {
    return {
      ...NO_DESTINATION,
      city_id: input.nameMatch.id,
      match_method: "name",
    };
  }
  return { ...NO_DESTINATION, match_method: "none" };
}

/**
 * The value to store in orders.customer_city after resolution. When Darb Assabil
 * resolved the destination we snapshot its CANONICAL city name (so the dispatch
 * modal's `resolveDarbDestination` matches reliably, immune to storefront spelling
 * drift). Otherwise the raw storefront string is kept unchanged.
 */
export function resolvedCustomerCity(
  resolution: CityResolution,
  rawCustomerCity: string | null,
): string | null {
  return resolution.darb_city ?? rawCustomerCity;
}

export interface ResolveCityParams {
  platform: string;
  market_id: string;
  customer_city: string | null;
}

/**
 * IO wrapper: does a market-scoped normalized-name match against the right
 * destination table, then defers to the pure core.
 */
export async function resolveCity(
  adminClient: SupabaseClient,
  params: ResolveCityParams,
): Promise<CityResolution> {
  const isDexpressMarket = marketIdToCode(params.market_id) === "ly";

  let nameMatch: CityNameMatch | null = null;
  const target = normalizeCityName(params.customer_city);
  if (target) {
    if (isDexpressMarket) {
      // Libya — resolve the PRIMARY carrier (Darb Assabil) first, then fall back
      // to the Dexpress state list only if Darb doesn't serve the city.
      const { data: darbData } = await adminClient
        .from("darb_destinations")
        .select("id, city, area")
        .eq("is_active", true);
      const darbRows =
        (darbData as Array<{ id: number; city: string; area: string }> | null) ??
        [];
      // Resolve the storefront string against Darb by city → area → alias. This
      // catches strings that are actually Darb AREA names (شحات, جنزور) or
      // spelling variants/umbrella labels (ورشفانه, ضواحي طرابلس), not just exact
      // city names. The canonical (city, area) is then mapped to its DB row id.
      const darb = resolveDarbAny(params.customer_city);
      if (darb) {
        const wantCity = normalizeCityName(darb.city);
        if (darb.area != null) {
          // Exact pair (single-area city or a resolved area) → find its row id.
          const wantArea = normalizeCityName(darb.area);
          const row = darbRows.find(
            (d) =>
              normalizeCityName(d.city) === wantCity &&
              normalizeCityName(d.area) === wantArea,
          );
          nameMatch = {
            kind: "darb",
            id: row ? row.id : null,
            city: darb.city,
            area: darb.area,
          };
        } else {
          // Multi-area city, area undecided → snapshot the city only.
          nameMatch = { kind: "darb", id: null, city: darb.city, area: null };
        }
      } else {
        // Fallback — match against active Dexpress states. dexpress_states has a
        // single `name` column (Arabic); there is no name_ar.
        const { data } = await adminClient
          .from("dexpress_states")
          .select("id, name")
          .eq("status", 1);
        const rows =
          (data as Array<{ id: number; name: string }> | null) ?? [];
        const hit = rows.find((s) => normalizeCityName(s.name) === target);
        nameMatch = hit ? { kind: "dexpress", id: hit.id } : null;
      }
    } else {
      // Tunisia — match against market-scoped cities (name / name_ar).
      const { data } = await adminClient
        .from("cities")
        .select("id, market_id, name, name_ar")
        .eq("market_id", params.market_id);
      const rows =
        (data as Array<{
          id: string;
          market_id: string;
          name: string;
          name_ar: string | null;
        }> | null) ?? [];
      const hit = rows.find(
        (c) =>
          normalizeCityName(c.name) === target ||
          normalizeCityName(c.name_ar) === target,
      );
      nameMatch = hit
        ? { kind: "city", id: hit.id, market_id: hit.market_id }
        : null;
    }
  }

  return decideCityResolution({ isDexpressMarket, nameMatch });
}
