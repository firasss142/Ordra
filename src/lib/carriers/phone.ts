// Libyan mobile numbers carry exactly 10 digits in local form, e.g. 091XXXXXXX
// or 092XXXXXXX. Shipping Eyes (carrier) requires the 10-digit local form.

export class LibyanPhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibyanPhoneError";
  }
}

const LIBYAN_LOCAL_RE = /^0(9[0-9])\d{7}$/;

export function normalizeLibyanPhone(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new LibyanPhoneError("Phone number is empty");
  }

  let digits = raw.replace(/[^\d+]/g, "");
  digits = digits.replace(/^00/, "+");
  digits = digits.replace(/^\+218/, "");
  digits = digits.replace(/^218/, "");
  digits = digits.replace(/^\+/, "");

  if (digits.length === 9 && digits.startsWith("9")) {
    digits = `0${digits}`;
  }

  if (!LIBYAN_LOCAL_RE.test(digits)) {
    throw new LibyanPhoneError(
      `Invalid Libyan phone number: "${raw}" (normalized to "${digits}")`
    );
  }

  return digits;
}

export function isValidLibyanPhone(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  try {
    normalizeLibyanPhone(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The E.164 form Darb Assabil's validator accepts ("+218" + 9 significant
 * digits), or null when the value is not a Libyan mobile number at all.
 * Accepts every way an agent types it: 09X…, 9X…, +218…, 00218…, 218….
 */
export function toLibyanE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  digits = digits.replace(/^00218/, "").replace(/^218/, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1);
  return /^9\d{8}$/.test(digits) ? `+218${digits}` : null;
}
