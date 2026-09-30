/**
 * Is this inbound text a request to stop receiving messages?
 *
 * No consent is captured (owner's decision, 2026-09-25), so this reply is the
 * only brake a customer has — and Meta's quality rating punishes a number
 * whose recipients block it. The match is EXACT after normalisation: a
 * sentence that merely contains "stop" is a customer talking, not opting out,
 * and a false positive silences someone who wanted their parcel.
 */

const KEYWORDS = new Set([
  // Latin
  "stop",
  "arret",
  "unsubscribe",
  "desabonner",
  "desinscrire",
  "non",
  // Arabic (bare alef forms — normalisation folds the hamza variants)
  "توقف",
  "ايقاف",
  "الغاء",
  "وقف",
]);

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

/** Punctuation and symbols, Latin and Arabic, including quotes. */
const STRIP = /[\p{P}\p{S}]/gu;
/** The kashida (U+0640) is a stretch mark inside a word, not a separator. */
const TATWEEL = /\u0640/g;

export function normalizeOptOutText(text: string): string {
  return text
    .normalize("NFD")
    // Combining marks: Latin accents AND Arabic harakat / hamza-above both live here.
    .replace(/\p{M}/gu, "")
    .replace(TATWEEL, "")
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) & 0xf))
    .replace(STRIP, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isOptOutText(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeOptOutText(text);
  if (!normalized) return false;
  return KEYWORDS.has(normalized);
}
