import type { SupabaseClient } from "@supabase/supabase-js";
import type { CityResolution } from "./resolver-types";
import { marketIdToCode } from "@/lib/markets";

/**
 * Resolves a webhook order's destination — market-aware, because the two
 * markets have different carrier models:
 *
 *   - Tunisia: the destination is an OMS city (cities.id → orders.city_id).
 *   - Libya:   the carrier is Dexpress, whose state list IS the destination
 *              catalogue. The destination is a dexpress_states.id
 *              (→ orders.dexpress_state_id). orders.city_id stays null.
 *
 * The two are mutually exclusive on an order, matching the orders PATCH
 * contract (setting one clears the other).
 *
 * Resolution order, strongest first (per market):
 *   1. External-id mapping — external_city_mappings on (platform,
 *      external_city_id). For Tunisia the resolved city's market must equal
 *      the storefront's market (mismatch is flagged, never silently applied).
 *      For Libya the mapping must carry a dexpress_state_id; a mapping row
 *      with a null dexpress_state_id is treated as INCOMPLETE and falls
 *      through (this is exactly the #AC3FDD16 bug — a city was bound but no
 *      Dexpress state, so the order was never truly resolved for upload).
 *   2. Name normalization — case/space-insensitive match against the
 *      market's destination table (cities for TN, dexpress_states for LY).
 *   3. Unmatched.
 *
 * Split like auto-assignment: `decideCityResolution` is the pure decision
 * core, `resolveCity` is the thin IO wrapper. `normalizeCityName` is exported
 * so the handler/UI can normalize consistently.
 */

/** Normalizes a city name for comparison: trim, collapse whitespace, lowercase. */
export function normalizeCityName(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A normalized-name match — discriminated by market kind:
 *   - "city"     → a cities row (Tunisia)
 *   - "dexpress" → a dexpress_states row (Libya)
 */
export type CityNameMatch =
  | { kind: "city"; id: string; market_id: string }
  | { kind: "dexpress"; id: number };

/** Pre-fetched inputs the pure decision core needs. */
export interface CityResolverInput {
  /** True when the storefront's market uses Dexpress as its destination catalogue (Libya). */
  isDexpressMarket: boolean;
  /**
   * external_city_mappings row, or null.
   * - Tunisia: `city_id` + `city_market_id` are set (the resolved city and
   *   its market, for the cross-market guard); `dexpress_state_id` is null.
   * - Libya: `dexpress_state_id` is the resolved destination; `city_id` /
   *   `city_market_id` may be a stale legacy value and are ignored.
   */
  mappingRow: {
    city_id: string | null;
    city_market_id: string | null;
    dexpress_state_id: number | null;
  } | null;
  /** The storefront's market — the authority on which market this order is in. */
  storefrontMarketId: string;
  /** The destination matched by normalized-name lookup, or null. */
  nameMatch: CityNameMatch | null;
}

/** Pure, deterministic resolution decision — no IO. */
export function decideCityResolution(input: CityResolverInput): CityResolution {
  if (input.isDexpressMarket) {
    // --- Libya: destination is a dexpress_states id ---
    if (input.mappingRow && input.mappingRow.dexpress_state_id != null) {
      return {
        city_id: null,
        dexpress_state_id: input.mappingRow.dexpress_state_id,
        match_method: "external_id",
      };
    }
    // A mapping row with no dexpress_state_id is INCOMPLETE — do not apply it;
    // fall through to the name match (and then to unmatched).
    if (input.nameMatch && input.nameMatch.kind === "dexpress") {
      return {
        city_id: null,
        dexpress_state_id: input.nameMatch.id,
        match_method: "name",
      };
    }
    return { city_id: null, dexpress_state_id: null, match_method: "none" };
  }

  // --- Tunisia: destination is a cities id ---
  if (input.mappingRow && input.mappingRow.city_id != null) {
    if (input.mappingRow.city_market_id === input.storefrontMarketId) {
      return {
        city_id: input.mappingRow.city_id,
        dexpress_state_id: null,
        match_method: "external_id",
      };
    }
    // Mapping points at a city in another market — surface it, never apply.
    return {
      city_id: null,
      dexpress_state_id: null,
      match_method: "market_mismatch",
    };
  }
  if (input.nameMatch && input.nameMatch.kind === "city") {
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
 * IO wrapper: looks up the external-id mapping, then — if that misses or is
 * incomplete — does a market-scoped name match against the right destination
 * table, then defers to the pure core.
 */
export async function resolveCity(
  adminClient: SupabaseClient,
  params: ResolveCityParams,
): Promise<CityResolution> {
  const isDexpressMarket = marketIdToCode(params.market_id) === "ly";

  // 1. External-id mapping — only when the payload carried an external city id.
  //    One query shape serves both markets: the embedded `cities` relation
  //    simply comes back null for Libya-bound mapping rows.
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
        city_id: string | null;
        dexpress_state_id: number | null;
        cities:
          | { id: string; market_id: string }
          | { id: string; market_id: string }[]
          | null;
      };
      const city = Array.isArray(row.cities) ? row.cities[0] : row.cities;
      mappingRow = {
        city_id: row.city_id,
        city_market_id: city?.market_id ?? null,
        dexpress_state_id: row.dexpress_state_id,
      };
    }
  }

  // Short-circuit only when the mapping is COMPLETE for this market. An
  // incomplete Libya mapping (no dexpress_state_id) must fall through to the
  // name match, so we let the pure core decide rather than returning early.
  const mappingIsComplete = isDexpressMarket
    ? mappingRow?.dexpress_state_id != null
    : mappingRow?.city_id != null;
  if (mappingRow && mappingIsComplete) {
    return decideCityResolution({
      isDexpressMarket,
      mappingRow,
      storefrontMarketId: params.market_id,
      nameMatch: null,
    });
  }

  // 2. Name normalization against the market's destination table.
  let nameMatch: CityNameMatch | null = null;
  const target = normalizeCityName(params.customer_city);
  if (target) {
    if (isDexpressMarket) {
      // Libya — match against active Dexpress states. dexpress_states has a
      // single `name` column (Arabic); there is no name_ar.
      const { data } = await adminClient
        .from("dexpress_states")
        .select("id, name")
        .eq("status", 1);
      const rows =
        (data as Array<{ id: number; name: string }> | null) ?? [];
      const hit = rows.find((s) => normalizeCityName(s.name) === target);
      nameMatch = hit ? { kind: "dexpress", id: hit.id } : null;
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

  return decideCityResolution({
    isDexpressMarket,
    mappingRow,
    storefrontMarketId: params.market_id,
    nameMatch,
  });
}
