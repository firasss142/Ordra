import type { SupabaseClient } from "@supabase/supabase-js";
import type { CityResolution } from "./resolver-types";

/**
 * Resolves a webhook order's destination to an OMS city (cities.id) and, when
 * known, a Dexpress routing state. Today the webhook handler never populates
 * orders.city_id at all — this is the fix.
 *
 * Resolution order, strongest first:
 *   1. External-id mapping — external_city_mappings on
 *      (platform, external_city_id). The resolved city's market MUST equal the
 *      storefront's market; a mismatch is flagged, never silently accepted.
 *   2. Name normalization — case/space-insensitive match against cities.name
 *      and cities.name_ar, market-scoped. This is the Shopify-style fallback
 *      (Shopify sends only a free-text city string).
 *   3. Unmatched — city_id stays null.
 *
 * Split like auto-assignment: `decideCityResolution` is the pure decision core,
 * `resolveCity` is the thin IO wrapper. `normalizeCityName` is exported so the
 * handler/UI can normalize consistently.
 */

/** Normalizes a city name for comparison: trim, collapse whitespace, lowercase. */
export function normalizeCityName(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Pre-fetched inputs the pure decision core needs. */
export interface CityResolverInput {
  /**
   * external_city_mappings row joined to its city, or null. `city_market_id`
   * is the market of the *resolved* city — compared against the storefront's.
   */
  mappingRow: {
    city_id: string;
    city_market_id: string;
    dexpress_state_id: number | null;
  } | null;
  /** The storefront's market — the authority on which market this order is in. */
  storefrontMarketId: string;
  /** The city row matched by normalized-name lookup (already market-scoped), or null. */
  nameMatch: { id: string; market_id: string } | null;
}

/** Pure, deterministic resolution decision — no IO. */
export function decideCityResolution(input: CityResolverInput): CityResolution {
  if (input.mappingRow) {
    if (input.mappingRow.city_market_id === input.storefrontMarketId) {
      return {
        city_id: input.mappingRow.city_id,
        dexpress_state_id: input.mappingRow.dexpress_state_id,
        match_method: "external_id",
      };
    }
    // A mapping exists but points at a city in another market. Do NOT apply it
    // — surface it for a human instead. (One storefront = one market, so this
    // means either the mapping or the storefront config is wrong.)
    return {
      city_id: null,
      dexpress_state_id: null,
      match_method: "market_mismatch",
    };
  }
  if (input.nameMatch) {
    return {
      city_id: input.nameMatch.id,
      dexpress_state_id: null,
      match_method: "name",
    };
  }
  return { city_id: null, dexpress_state_id: null, match_method: "none" };
}

export interface ResolveCityParams {
  platform: string;
  market_id: string;
  external_city_id: string | null;
  customer_city: string | null;
}

/**
 * IO wrapper: looks up the external-id mapping (joined to its city for the
 * market check), then — only if that misses — does a market-scoped name match,
 * then defers to the pure core.
 */
export async function resolveCity(
  adminClient: SupabaseClient,
  params: ResolveCityParams,
): Promise<CityResolution> {
  // 1. External-id mapping — only when the payload carried an external city id.
  let mappingRow: CityResolverInput["mappingRow"] = null;
  if (params.external_city_id) {
    const { data } = await adminClient
      .from("external_city_mappings")
      .select("city_id, dexpress_state_id, cities(id, market_id)")
      .eq("platform", params.platform)
      .eq("external_city_id", params.external_city_id)
      .maybeSingle();
    if (data) {
      // Supabase types an embedded relation as an array; at runtime a
      // to-one join is a single object. Accept either shape.
      const row = data as unknown as {
        city_id: string;
        dexpress_state_id: number | null;
        cities:
          | { id: string; market_id: string }
          | { id: string; market_id: string }[]
          | null;
      };
      const city = Array.isArray(row.cities) ? row.cities[0] : row.cities;
      if (city) {
        mappingRow = {
          city_id: row.city_id,
          city_market_id: city.market_id,
          dexpress_state_id: row.dexpress_state_id,
        };
      }
    }
  }
  if (mappingRow) {
    return decideCityResolution({
      mappingRow,
      storefrontMarketId: params.market_id,
      nameMatch: null,
    });
  }

  // 2. Name normalization, market-scoped. Fetch the market's cities and match
  //    in-memory against both name and name_ar (avoids DB-specific ILIKE/locale
  //    quirks and keeps the comparison identical to normalizeCityName).
  let nameMatch: CityResolverInput["nameMatch"] = null;
  const target = normalizeCityName(params.customer_city);
  if (target) {
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
    nameMatch = hit ? { id: hit.id, market_id: hit.market_id } : null;
  }

  return decideCityResolution({
    mappingRow: null,
    storefrontMarketId: params.market_id,
    nameMatch,
  });
}
