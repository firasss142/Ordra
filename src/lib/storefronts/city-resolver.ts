import type { SupabaseClient } from "@supabase/supabase-js";
import type { CityResolution } from "./resolver-types";
import { marketIdToCode } from "@/lib/markets";

/**
 * Resolves a webhook order's destination — name-only, market-aware.
 *
 * The storefront city is always a value the customer picked from a constrained
 * dropdown whose options mirror our destination tables. So resolution is a
 * single stage: normalize `customer_city` and exact-match it against the
 * market's destination table.
 *
 *   - Tunisia: the destination is an OMS city (cities.id → orders.city_id).
 *   - Libya:   the carrier is Dexpress, whose state list IS the destination
 *              catalogue. The destination is a dexpress_states.id
 *              (→ orders.dexpress_state_id). orders.city_id stays null.
 *
 * The two are mutually exclusive on an order, matching the orders PATCH
 * contract (setting one clears the other).
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
  /** The destination matched by normalized-name lookup, or null. */
  nameMatch: CityNameMatch | null;
}

/** Pure, deterministic resolution decision — no IO. */
export function decideCityResolution(input: CityResolverInput): CityResolution {
  if (input.isDexpressMarket) {
    // --- Libya: destination is a dexpress_states id ---
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

  return decideCityResolution({ isDexpressMarket, nameMatch });
}
