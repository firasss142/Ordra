import { normalizeCityName } from "@/lib/storefronts/normalize-city";

/**
 * Curated aliases for storefront city labels that have NO 1:1 Darb city/area
 * but ARE deliverable by Darb under a known city — umbrella/region labels and a
 * few storefront-only short forms. Used only as the LAST resort in resolution,
 * after exact city and area matching both miss (see resolveDarbAny).
 *
 * The VALUE is a canonical Darb city name (must exist in darb-assabil-areas-data
 * as a city key). A multi-area target resolves to the city only (area picked at
 * dispatch); a single-area target resolves to its one pair.
 *
 * Genuinely unmappable junk (e.g. "المنطقة الوسطي \ تخفيض") is intentionally
 * ABSENT — those fall through to the Dexpress fallback / "uncovered" warning.
 *
 * Keys are matched via normalizeCityName, so spelling/diacritic/paren variants
 * of the same label collapse automatically — list the most readable form.
 *
 * Add new entries here as fresh labels appear in the unmatched-city report.
 */
const RAW_ALIASES: Record<string, string> = {
  // Region / umbrella labels
  "ضواحي طرابلس": "طرابلس", // "Tripoli suburbs" → Tripoli (area chosen at dispatch)
  "الجبل الغربي": "غريان", // "Western Mountain" region → Gharyan
  // Storefront short forms of the compound city "جالو اوجلة"
  "جالو": "جالو اوجلة",
  "اوجلة": "جالو اوجلة",
  // Leading-alef short form not caught by letter folding
  "امساعد": "مساعد",
};

/** Normalized-label → canonical Darb city. Built once at module load. */
const NORM_ALIAS_TO_CITY = new Map<string, string>();
for (const [label, city] of Object.entries(RAW_ALIASES)) {
  NORM_ALIAS_TO_CITY.set(normalizeCityName(label), city);
}

/** The canonical Darb city for an aliased label, or null if not aliased. */
export function darbCityForAlias(
  label: string | null | undefined,
): string | null {
  return NORM_ALIAS_TO_CITY.get(normalizeCityName(label)) ?? null;
}
