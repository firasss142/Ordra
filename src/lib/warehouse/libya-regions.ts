/**
 * Libyan cities grouped into the three regions the Darb sticker rolls follow.
 *
 * The rolls are colour-coded PER REGION, not per city — confirmed by the user
 * on 2026-08-18. Which colour belongs to which region is still unknown, and
 * `docs/darb-warehouse-workflow.md` records that it is not even established
 * whether a roll must match its destination. So this file groups; it does not
 * colour. Add the colours here once Darb confirms them.
 *
 * City names arrive from the storefront in Arabic, occasionally transliterated,
 * so lookup is accent- and script-tolerant and falls back to "unknown" rather
 * than guessing a region.
 */

export type LibyaRegion = "ouest" | "est" | "sud" | "unknown";

export const LIBYA_REGION_LABELS: Record<LibyaRegion, { fr: string; ar: string }> = {
  ouest: { fr: "Ouest", ar: "المنطقة الغربية" },
  est: { fr: "Est", ar: "المنطقة الشرقية" },
  sud: { fr: "Sud", ar: "المنطقة الجنوبية" },
  unknown: { fr: "Région à confirmer", ar: "منطقة غير محددة" },
};

/** Arabic city → region. Latin aliases follow below. */
const CITY_REGION: Record<string, LibyaRegion> = {
  // ── Ouest ──
  "طرابلس": "ouest", "الزاوية": "ouest", "صبراتة": "ouest", "زوارة": "ouest",
  "العجيلات": "ouest", "الخمس": "ouest", "زليتن": "ouest", "مسلاتة": "ouest",
  "مصراتة": "ouest", "غريان": "ouest", "ترهونة": "ouest", "بني وليد": "ouest",
  "صرمان": "ouest", "الماية": "ouest", "بوعيسى": "ouest", "المطرد": "ouest",
  "يفرن": "ouest", "نالوت": "ouest", "الزنتان": "ouest", "ككلة": "ouest",
  "القره بوللي": "ouest", "تاجوراء": "ouest", "جنزور": "ouest",
  // ── Est ──
  "بنغازي": "est", "البيضاء": "est", "المرج": "est", "درنة": "est",
  "طبرق": "est", "اجدابيا": "est", "البريقة": "est", "شحات": "est",
  "سوسة": "est", "القبة": "est", "توكرة": "est", "الأبيار": "est",
  "قصر ليبيا": "est", "مسة": "est", "مراوة": "est", "اسلنطة": "est",
  "قندولة": "est", "بشر": "est", "العقيلة": "est", "امساعد": "est",
  // ── Sud ──
  "سبها": "sud", "أوباري": "sud", "اوباري": "sud", "مرزق": "sud",
  "الجفرة": "sud", "هون": "sud", "سوكنة": "sud", "ودان": "sud",
  "زلة": "sud", "غات": "sud", "الشاطئ": "sud", "براك": "sud",
  "الكفرة": "sud", "تازربو": "sud",
};

/** Latin spellings we see from storefronts and carrier payloads. */
const LATIN_ALIASES: Record<string, LibyaRegion> = {
  tripoli: "ouest", zawiya: "ouest", sabratha: "ouest", zuwara: "ouest",
  khoms: "ouest", alkhums: "ouest", zliten: "ouest", misrata: "ouest",
  misurata: "ouest", gharyan: "ouest", tarhuna: "ouest", "bani walid": "ouest",
  sorman: "ouest", yafran: "ouest", nalut: "ouest", zintan: "ouest",
  janzour: "ouest", tajoura: "ouest",
  benghazi: "est", bayda: "est", albayda: "est", marj: "est", derna: "est",
  tobruk: "est", ajdabiya: "est", brega: "est", shahat: "est", susa: "est",
  quba: "est", tocra: "est",
  sebha: "sud", sabha: "sud", ubari: "sud", murzuq: "sud", jufra: "sud",
  hun: "sud", ghat: "sud", brak: "sud", kufra: "sud",
};

/** Strip Arabic diacritics and normalise the alef/ya/ta-marbuta variants. */
function normaliseArabic(input: string): string {
  return input
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

const NORMALISED_CITY_REGION = new Map<string, LibyaRegion>(
  Object.entries(CITY_REGION).map(([city, region]) => [normaliseArabic(city), region]),
);

export function regionForCity(city: string | null | undefined): LibyaRegion {
  if (!city) return "unknown";
  const raw = city.trim();
  if (!raw) return "unknown";

  const arabic = normaliseArabic(raw);
  const direct = NORMALISED_CITY_REGION.get(arabic);
  if (direct) return direct;

  const latin = raw.toLowerCase().replace(/[^a-z\s]/g, "").trim();
  if (latin && LATIN_ALIASES[latin]) return LATIN_ALIASES[latin];

  // Storefronts often send "Tripoli - Janzour" or "طرابلس / جنزور".
  for (const part of raw.split(/[-/،,|]/)) {
    const p = part.trim();
    if (!p) continue;
    const byArabic = NORMALISED_CITY_REGION.get(normaliseArabic(p));
    if (byArabic) return byArabic;
    const byLatin = LATIN_ALIASES[p.toLowerCase().replace(/[^a-z\s]/g, "").trim()];
    if (byLatin) return byLatin;
  }

  return "unknown";
}

/** Display order: the roll a packer reaches for most often comes first. */
export const REGION_ORDER: LibyaRegion[] = ["ouest", "est", "sud", "unknown"];
