/**
 * Darb Assabil destination city/area pairs (Libya).
 *
 * Sourced from the vendor's `GET /api/local/branches/public` endpoint
 * (probed 2026-06-02 — see memory `darb-assabil-api-facts`). The carrier
 * auto-resolves the destination branch from (city, area), so a shipment must
 * send a pair that exists here — an unknown combo triggers an obscure
 * `Cannot read properties of undefined (reading 'name')` rather than a clean
 * validation error.
 *
 * Both fields are Arabic UTF-8 (the API rejects transliterated values).
 *
 * 29 distinct (city, area) pairs across 26 cities. Most cities have a single
 * area equal to the city name; only طرابلس (Tripoli) is subdivided (4 areas).
 * This list is static because the branch set rarely changes; re-probe and
 * regenerate if the carrier expands coverage.
 */
export interface DarbAssabilArea {
  /** Destination city (Arabic). */
  city: string;
  /** Destination area / neighbourhood within the city (Arabic). */
  area: string;
}

export const DARB_ASSABIL_AREAS: readonly DarbAssabilArea[] = [
  // طرابلس (Tripoli) — the only multi-area city.
  { city: "طرابلس", area: "الرياضية" },
  { city: "طرابلس", area: "طرابلس" },
  { city: "طرابلس", area: "زناتة" },
  { city: "طرابلس", area: "حي الأندلس" },
  // Single-area cities (area == city).
  { city: "بنغازي", area: "بنغازي" },
  { city: "تاجوراء", area: "تاجوراء" },
  { city: "قصر خيار", area: "قصر خيار" },
  { city: "صبراتة", area: "صبراتة" },
  { city: "بني وليد", area: "بني وليد" },
  { city: "البريقة", area: "البريقة" },
  { city: "ترهونة", area: "ترهونة" },
  { city: "القبة", area: "القبة" },
  { city: "اجدابيا", area: "اجدابيا" },
  { city: "رأس لانوف", area: "رأس لانوف" },
  { city: "جالو اوجلة", area: "جالو اوجلة" },
  { city: "الجفرة", area: "هون" },
  { city: "سرت", area: "سرت" },
  { city: "زوارة", area: "زوارة" },
  { city: "العجيلات", area: "العجيلات" },
  { city: "مصراتة", area: "مصراتة" },
  { city: "الخمس", area: "الخمس" },
  { city: "طبرق", area: "طبرق" },
  { city: "درنة", area: "درنة" },
  { city: "البيضاء", area: "البيضاء" },
  { city: "المرج", area: "المرج" },
  { city: "الزاوية", area: "الزاوية" },
  { city: "غريان", area: "غريان" },
  { city: "الكفرة", area: "الكفرة" },
  { city: "سبها", area: "سبها" },
];
