/**
 * The one builder for the number WhatsApp addresses: `<dial><national>`, no
 * plus sign. Built on `normalizePhone` so the WhatsApp identity of a customer
 * is the same key as `customers.phone_normalized`.
 *
 * Mirrored exactly by `public.whatsapp_e164(text, text)` in SQL — the trigger
 * that enqueues lifecycle messages uses that one; keep them in step.
 */
import { normalizePhone } from "@/lib/leads/phone";
import { MARKET_DIAL_CODE, type MarketCode } from "@/lib/markets";

/**
 * Tunisia: any 8 digits (mobile and landline both receive SMS/WhatsApp is a
 * mobile matter, but the plan does not let us tell them apart by length).
 * Libya: a mobile is 9 digits starting with 9 — Darb accepts 021 landlines,
 * WhatsApp cannot deliver to one.
 */
const NATIONAL_PATTERN: Record<MarketCode, RegExp> = {
  tn: /^[0-9]{8}$/,
  ly: /^9[0-9]{8}$/,
};

export function toWhatsAppE164(
  phone: string | null | undefined,
  marketCode: MarketCode,
): string | null {
  if (!phone || !phone.trim()) return null;
  let national = normalizePhone(phone);
  // normalize_phone only drops a trunk zero on Libya's 9-digit plan. Tunisian
  // numbers never start with 0, so a leading zero there is a typing habit
  // ("0 98 765 432"), not a digit — the wa.me helpers accepted it, so do we.
  if (marketCode === "tn" && /^0[0-9]{8}$/.test(national)) national = national.slice(1);
  if (!NATIONAL_PATTERN[marketCode].test(national)) return null;
  return MARKET_DIAL_CODE[marketCode] + national;
}

export interface ParsedWaId {
  marketCode: MarketCode;
  national: string;
  e164: string;
}

/** Inverse: Meta's `wa_id` / `from` → market + national digits, or null. */
export function fromWaId(waId: string | null | undefined): ParsedWaId | null {
  if (!waId) return null;
  const digits = waId.replace(/\D/g, "");
  for (const code of Object.keys(MARKET_DIAL_CODE) as MarketCode[]) {
    const dial = MARKET_DIAL_CODE[code];
    if (!digits.startsWith(dial)) continue;
    const national = digits.slice(dial.length);
    if (NATIONAL_PATTERN[code].test(national)) {
      return { marketCode: code, national, e164: dial + national };
    }
  }
  return null;
}
