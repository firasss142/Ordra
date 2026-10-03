import { normalizeCityName } from "@/lib/storefronts/normalize-city";

/**
 * French names for the Libyan cities Darb writes in Arabic (`darb_shipments
 * .to_city`). The Darb catalogue is Arabic only, so a French screen would
 * otherwise mix scripts. An unknown city is shown as the carrier wrote it.
 */
const FR: Record<string, string> = {
  "طرابلس": "Tripoli", "بنغازي": "Benghazi", "سبها": "Sebha", "مصراتة": "Misrata", "الخمس": "Khoms",
  "غريان": "Gharyan", "الزاوية": "Zawiya", "البيضاء": "Al Bayda", "طبرق": "Tobrouk", "الكفرة": "Koufra",
  "زوارة": "Zouara", "اجدابيا": "Ajdabiya", "صبراتة": "Sabratha", "البريقة": "Brega", "المرج": "Al Marj",
  "سرت": "Syrte", "جالو": "Jalu", "جالو اوجلة": "Jalu-Awjila", "درنة": "Derna", "زليتن": "Zliten",
  "ترهونة": "Tarhouna", "بني وليد": "Bani Walid", "صرمان": "Sorman", "الجميل": "Al Jamil",
  "العجيلات": "Al Ajaylat", "رقدالين": "Regdalin", "زلطن": "Zelten", "نالوت": "Nalout", "يفرن": "Yefren",
  "الزنتان": "Zintan", "جادو": "Jadu", "مزدة": "Mizda", "ودان": "Waddan", "هون": "Houn", "سوكنة": "Sokna",
  "الجفرة": "Al Joufra", "اوباري": "Oubari", "مرزق": "Mourzouq", "غات": "Ghat", "براك": "Brak",
  "القطرون": "Al Qatrun", "تاجوراء": "Tajoura", "جنزور": "Janzour", "القره بوللي": "Garabulli",
  "مسلاتة": "Msallata", "الابيار": "Al Abyar", "توكرة": "Tocra", "سلوق": "Suluq", "قمينس": "Qaminis",
  "شحات": "Shahhat", "سوسة": "Susa", "القبة": "Al Qubbah", "مساعد": "Musaid", "بئر الغنم": "Bir al-Ghanam",
  "الرجبان": "Rujban", "الاصابعة": "Al Asabaa", "كاباو": "Kabaw", "الرياينة": "Riyayna", "الشويرف": "Shwayrif",
  "الكفرة الجديدة": "Koufra", "تراغن": "Traghen", "ادري": "Idri", "زويلة": "Zuwaylah", "الابرق": "Al Abraq",
};

const BY_KEY = new Map(Object.entries(FR).map(([ar, fr]) => [normalizeCityName(ar), fr]));

export function cityLabel(city: string, locale: string): string {
  const trimmed = city.trim();
  if (locale === "ar") return trimmed;
  return BY_KEY.get(normalizeCityName(trimmed)) ?? trimmed;
}
