export const RETURN_REASONS = [
  "packaging",
  "product_defect",
  "customer_damage",
  "carrier_damage",
  "other",
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface ScanReturnInput {
  order_id?: string;
  is_damaged?: boolean;
  return_reason?: string | null;
  return_photo_url?: string | null;
  return_reason_note?: string | null;
}

export interface ValidatedScanReturn {
  order_id: string;
  is_damaged: boolean;
  return_reason: ReturnReason | null;
  return_photo_url: string | null;
  return_reason_note: string | null;
}

export type ValidationResult =
  | { ok: true; data: ValidatedScanReturn }
  | { ok: false; error: string };

export function validateScanReturnBody(
  body: ScanReturnInput,
): ValidationResult {
  const orderId = body.order_id?.trim();
  if (!orderId) return { ok: false, error: "Missing order_id" };

  const isDamaged = Boolean(body.is_damaged);

  if (!isDamaged) {
    return {
      ok: true,
      data: {
        order_id: orderId,
        is_damaged: false,
        return_reason: null,
        return_photo_url: null,
        return_reason_note: null,
      },
    };
  }

  const reason = body.return_reason ?? null;
  if (!reason) {
    return { ok: false, error: "return_reason is required for damaged returns" };
  }
  if (!RETURN_REASONS.includes(reason as ReturnReason)) {
    return { ok: false, error: `Unknown return_reason: ${reason}` };
  }

  const note = body.return_reason_note?.trim() || null;
  if (reason === "other" && !note) {
    return {
      ok: false,
      error: "return_reason_note is required when return_reason is 'other'",
    };
  }

  const photo = body.return_photo_url?.trim() || null;

  return {
    ok: true,
    data: {
      order_id: orderId,
      is_damaged: true,
      return_reason: reason as ReturnReason,
      return_photo_url: photo,
      return_reason_note: note,
    },
  };
}
