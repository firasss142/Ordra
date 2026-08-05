import { normalizeLibyanPhone } from "@/lib/carriers/phone";

/**
 * Phone numbers are stored in LOCAL form — Tunisian 8-digit, Libyan
 * 09XXXXXXXX (Dexpress rejects anything else, see
 * memory/dexpress-dispatch-failure-modes.md). wa.me needs full international
 * with no plus sign, so the two forms have to be bridged explicitly rather
 * than by string concatenation at the call site.
 */

export type MarketCode = "tn" | "ly";

const DIAL_CODE: Record<MarketCode, string> = { tn: "216", ly: "218" };

/** National significant digits, i.e. after the trunk zero and dial code. */
const NATIONAL_LENGTH: Record<MarketCode, number> = { tn: 8, ly: 9 };

export function toWhatsappNumber(
  phone: string | null | undefined,
  market: MarketCode,
): string | null {
  if (!phone || !phone.trim()) return null;

  const code = DIAL_CODE[market];
  if (!code) return null;

  // Libya has a real validator already (mobile prefixes are constrained);
  // reuse it rather than re-deriving the rules here.
  if (market === "ly") {
    try {
      const local = normalizeLibyanPhone(phone); // 09XXXXXXXX
      return code + local.slice(1);
    } catch {
      return null;
    }
  }

  let digits = phone.replace(/[^\d+]/g, "");

  let international = false;
  if (digits.startsWith("+")) {
    international = true;
    digits = digits.slice(1);
  } else if (digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;

  if (!international) {
    // A bare "216…" of exactly the right total length is already
    // international; anything else is national and needs the code prepended.
    if (digits.startsWith(code) && digits.length === code.length + NATIONAL_LENGTH[market]) {
      international = true;
    } else {
      digits = code + digits.replace(/^0+/, "");
    }
  }

  if (digits.length !== code.length + NATIONAL_LENGTH[market]) return null;

  return digits;
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
