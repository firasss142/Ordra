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
import { normalizeCityName } from "@/lib/storefronts/normalize-city";
import { darbCityForAlias } from "./darb-assabil-aliases";
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

// Normalized AREA name → { canonical city, canonical area }. Areas are unique
// across cities (verified against the live catalogue), so no collision handling.
const NORM_AREA_TO_PAIR = new Map<string, { city: string; area: string }>();
for (const [city, areas] of Object.entries(DARB_ASSABIL_CITIES)) {
  for (const area of areas) {
    NORM_AREA_TO_PAIR.set(normalizeCityName(area), { city, area });
  }
}

/**
 * Resolve a string that is a Darb AREA name (not a city) to its parent city and
 * canonical area spelling, or null if it isn't a known area. Many storefronts
 * send an area as the "city" (e.g. شحات → البيضاء/شحات, جنزور → طرابلس/جنزور).
 */
export function resolveDarbByArea(
  name: string | null | undefined,
): { city: string; area: string } | null {
  return NORM_AREA_TO_PAIR.get(normalizeCityName(name)) ?? null;
}

/**
 * The shared resolution entry point: map any storefront string to a Darb
 * destination, trying in order — (a) exact city, (b) area name, (c) curated
 * alias. Returns the canonical city and, when determined, the exact area
 * (null for a multi-area city whose area is chosen at dispatch). null when Darb
 * cannot serve it at all (caller falls back to Dexpress).
 */
export function resolveDarbAny(
  name: string | null | undefined,
): { city: string; area: string | null } | null {
  // (a) exact city
  const city = resolveDarbDestination(name);
  if (city) {
    return { city: city.city, area: city.areas.length === 1 ? city.areas[0] : null };
  }
  // (b) area name → exact pair
  const byArea = resolveDarbByArea(name);
  if (byArea) return { city: byArea.city, area: byArea.area };
  // (c) curated alias → canonical city (resolve its area the same way)
  const aliasCity = darbCityForAlias(name);
  if (aliasCity) {
    const resolved = resolveDarbDestination(aliasCity);
    if (resolved) {
      return {
        city: resolved.city,
        area: resolved.areas.length === 1 ? resolved.areas[0] : null,
      };
    }
  }
  return null;
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
 * Resolution matches the intake path (city → area → alias via resolveDarbAny),
 * so a customer_city that is an AREA name (شحات) or alias (ضواحي طرابلس) is
 * handled, not just exact city names.
 *
 * Rules:
 *  - Resolved to an exact (city, area) — single-area city OR an area-named string
 *    → dispatch that pair (selection ignored).
 *  - Resolved to a multi-area city (area undecided) → dispatch the selection only
 *    if it's a valid area of THAT city; otherwise open the scoped picker.
 *  - Unresolved city → dispatch the selection only if it's a valid pair (agent
 *    chose from the full picker); else full picker.
 */
export function resolveDispatchPair(
  customerCity: string | null | undefined,
  selection: DarbPickSelection
): DispatchPairDecision {
  const resolved = resolveDarbAny(customerCity);

  if (resolved) {
    if (resolved.area != null) {
      // Exact pair (single-area city or a resolved area name) → dispatch it.
      return { kind: "dispatch", city: resolved.city, area: resolved.area };
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

  // Unresolved city: only an explicit, valid selection dispatches.
  if (isValidPair(selection.city, selection.area)) {
    return {
      kind: "dispatch",
      city: selection.city as string,
      area: selection.area as string,
    };
  }
  return { kind: "pick", scopeCity: null };
}
