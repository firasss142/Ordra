import { normalizeCityName } from "@/lib/storefronts/city-resolver";
import { DEXPRESS_STATES } from "./dexpress/states";
import { DARB_ASSABIL_CITIES } from "./darb-assabil-areas";

/**
 * Per-carrier destination coverage for an order's city, computed client-side
 * from the bundled carrier geographies. No network, no DB.
 *
 *  - "covered"   — this carrier serves the order's city.
 *  - "uncovered" — the city is clearly real (it resolves for ANOTHER carrier)
 *                  but this carrier does not serve it. Safe to red-flag.
 *  - "unknown"   — no carrier recognises the city (or it's null). NEVER hard-block;
 *                  the carrier's own picker resolves it, so we only warn.
 *
 * The cross-carrier anchor avoids false "uncovered" flags caused by messy
 * customer_city strings (regions, parentheticals, spelling drift): a non-match
 * is only treated as a confident gap when some carrier positively recognises
 * the same city.
 */
export type CoverageState = "covered" | "uncovered" | "unknown";

export type CarrierCoverageCode = "dexpress" | "darb_assabil";

export type CoverageResult = Record<CarrierCoverageCode, CoverageState>;

const DEXPRESS_CITY_SET = new Set(
  DEXPRESS_STATES.map((s) => normalizeCityName(s.name))
);

const DARB_CITY_SET = new Set(
  Object.keys(DARB_ASSABIL_CITIES).map((city) => normalizeCityName(city))
);

/**
 * @param customerCity     the order's stored city (free-ish Arabic string)
 * @param dexpressStateId  resolved Dexpress destination id, if the order has one
 *                         (set at intake) — a positive Dexpress coverage signal
 *                         that doesn't depend on string matching.
 */
export function coverageFor(
  customerCity: string | null | undefined,
  dexpressStateId: number | null | undefined
): CoverageResult {
  const norm = normalizeCityName(customerCity);

  // Raw hits: does each carrier positively recognise the city?
  const dexpressHit =
    (dexpressStateId != null && Number.isFinite(dexpressStateId)) ||
    (norm.length > 0 && DEXPRESS_CITY_SET.has(norm));
  const darbHit = norm.length > 0 && DARB_CITY_SET.has(norm);

  // The city is "real" if at least one carrier recognises it. That anchors a
  // confident "uncovered" for the other carrier.
  const cityRecognised = dexpressHit || darbHit;

  const resolve = (hit: boolean): CoverageState => {
    if (hit) return "covered";
    return cityRecognised ? "uncovered" : "unknown";
  };

  return {
    dexpress: resolve(dexpressHit),
    darb_assabil: resolve(darbHit),
  };
}
