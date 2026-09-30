import { toWhatsAppE164 } from "@/lib/whatsapp/phone";

/**
 * Phone numbers are stored in LOCAL form — Tunisian 8-digit, Libyan
 * 09XXXXXXXX (Dexpress rejects anything else, see
 * memory/dexpress-dispatch-failure-modes.md). wa.me needs full international
 * with no plus sign, so the two forms have to be bridged explicitly rather
 * than by string concatenation at the call site.
 */

export type MarketCode = "tn" | "ly";



/**
 * A wrapper since the Cloud API landed: `toWhatsAppE164` is the one builder
 * (src/lib/whatsapp/phone.ts). Kept for its callers; goes in Phase 7.
 */
export function toWhatsappNumber(
  phone: string | null | undefined,
  market: MarketCode,
): string | null {
  return toWhatsAppE164(phone, market);
}

/** Full wa.me deep link, or null when the number cannot be normalized. */
export function buildWhatsappUrl(
  phone: string | null | undefined,
  market: MarketCode,
  message: string,
): string | null {
  const number = toWhatsappNumber(phone, market);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
