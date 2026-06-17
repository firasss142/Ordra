/**
 * Normalizes a city/area name for comparison. Storefronts send the same place
 * with many spellings; this folds them to one canonical form so they match the
 * carrier catalogue (Darb cities/areas, Dexpress states, OMS cities).
 *
 * Steps: drop a trailing count like " (15)"; strip Arabic diacritics (harakat)
 * and tatweel; fold hamza forms (أ/إ/آ→ا, bare ء removed); ة→ه; ى→ي; then trim,
 * collapse whitespace, lowercase. Latin text is unaffected beyond trim/lowercase.
 *
 * Lives in its own module (no imports) so both the storefront resolver and the
 * carrier-side catalogues can share it without an import cycle.
 */
export function normalizeCityName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "") // trailing parenthetical count, e.g. " (15)"
    .replace(/[ً-ْ]/g, "") // Arabic diacritics (harakat: fathatan…sukun)
    .replace(/ـ/g, "") // tatweel (kashida)
    .replace(/[أإآ]/g, "ا") // أ إ آ → ا
    .replace(/ء/g, "") // bare hamza ء → drop
    .replace(/ة/g, "ه") // ة → ه
    .replace(/ى/g, "ي") // ى → ي
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
