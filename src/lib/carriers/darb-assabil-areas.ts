/**
 * Darb Assabil deliverable destinations (Libya): city → ordered list of areas.
 *
 * Source of truth is `darb-assabil-areas-data.json`, generated from the vendor's
 * `GET /api/local/branches/public` (city + every `areas[].area`) AND then
 * validated combo-by-combo against `POST /api/local/shipments/calculate/shipping`
 * — only city/area pairs the carrier actually accepts are kept. See memory
 * `darb-assabil-api-facts`.
 *
 * Why validation is required: the branches list contains pairs the carrier
 * rejects (e.g. `تاجوراء/تاجوراء`, `طرابلس/طرابلس` → "Unable to fetch branch").
 * `تاجوراء` is only a deliverable AREA (under طرابلس), not a standalone city.
 *
 * The dispatch sends `to: { countryCode: "lby", city, area, address }` where
 * `area` MUST be one of the city's listed areas. All strings are Arabic UTF-8.
 *
 * Re-generate + re-validate (≈280 calls) if the carrier expands coverage.
 */
import { normalizeCityName } from "@/lib/storefronts/city-resolver";
import citiesData from "./darb-assabil-areas-data.json";

/** city (Arabic) → ordered list of deliverable areas (Arabic). */
export const DARB_ASSABIL_CITIES: Record<string, string[]> = citiesData;

/** A destination city resolved from an order's stored city, with its areas. */
export interface DarbDestination {
  city: string;
  areas: string[];
}

// Normalized-name → canonical city, for tolerant lookup.
const NORM_TO_CITY = new Map<string, string>();
for (const city of Object.keys(DARB_ASSABIL_CITIES)) {
  NORM_TO_CITY.set(normalizeCityName(city), city);
}

/** The deliverable areas for a city string (normalized match), or [] if unknown. */
export function darbAreasFor(city: string | null | undefined): string[] {
  const canonical = NORM_TO_CITY.get(normalizeCityName(city));
  return canonical ? DARB_ASSABIL_CITIES[canonical] : [];
}

/**
 * Resolve an order's stored city to a Darb Assabil destination (canonical city
 * + its full area list), or null when the carrier doesn't serve it as a city.
 */
export function resolveDarbDestination(
  customerCity: string | null | undefined
): DarbDestination | null {
  const canonical = NORM_TO_CITY.get(normalizeCityName(customerCity));
  if (!canonical) return null;
  return { city: canonical, areas: DARB_ASSABIL_CITIES[canonical] };
}

/** The picker's current selection (a chosen city/area pair, or empty). */
export interface DarbPickSelection {
  city: string | null;
  area: string | null;
}

export type DispatchPairDecision =
  | { kind: "dispatch"; city: string; area: string }
  | { kind: "pick"; scopeCity: string | null };

/** Is (city, area) a real deliverable pair? */
function isValidPair(city: string | null, area: string | null): boolean {
  if (!city || !area) return false;
  return darbAreasFor(city).some(
    (a) => normalizeCityName(a) === normalizeCityName(area)
  );
}

/**
 * Decide what to dispatch for a Darb Assabil order. The order's own city
 * resolution takes PRECEDENCE over the picker selection, so a stale or invalid
 * pick can never override a different order's real city.
 *
 *  - dispatch → caller sends { city, area } immediately.
 *  - pick     → caller opens the area picker; scopeCity restricts it to one
 *               city's areas, or is null (unknown city → full list).
 *
 * Rules:
 *  - Known single-area city → dispatch that pair (selection ignored).
 *  - Known multi-area city  → dispatch the selection only if it's a valid area
 *                             of THAT city; otherwise open the scoped picker.
 *  - Unknown city           → dispatch the selection only if it's a valid pair
 *                             (agent chose from the full picker); else full picker.
 */
export function resolveDispatchPair(
  customerCity: string | null | undefined,
  selection: DarbPickSelection
): DispatchPairDecision {
  const resolved = resolveDarbDestination(customerCity);

  if (resolved) {
    if (resolved.areas.length === 1) {
      return { kind: "dispatch", city: resolved.city, area: resolved.areas[0] };
    }
    // Multi-area: selection must belong to this city and be a valid area.
    const inCity =
      selection.city != null &&
      normalizeCityName(selection.city) === normalizeCityName(resolved.city) &&
      isValidPair(resolved.city, selection.area);
    return inCity
      ? { kind: "dispatch", city: resolved.city, area: selection.area as string }
      : { kind: "pick", scopeCity: resolved.city };
  }

  // Unknown city: only an explicit, valid selection dispatches.
  if (isValidPair(selection.city, selection.area)) {
    return {
      kind: "dispatch",
      city: selection.city as string,
      area: selection.area as string,
    };
  }
  return { kind: "pick", scopeCity: null };
}
