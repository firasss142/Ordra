/**
 * Small pure rules shared by the Réglages screens. Kept here, tested, so a
 * screen never re-derives them on its own.
 */

/**
 * A stored setting's plain value. Scalars are written as { value }, but older
 * rows carry { type } (assignment_algorithm) or { amount } (fees). Plain
 * objects (shift_config, ad_spend_fx_rates) are stored as they are.
 */
export function plainSettingValue(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.length === 1 && (keys[0] === "value" || keys[0] === "type" || keys[0] === "amount")) {
      return (raw as Record<string, unknown>)[keys[0]];
    }
  }
  return raw;
}

/**
 * History rows that record a real change. Format migrations wrote rows such as
 * { type: "manual" } → { value: "manual" }; shown, they read « Manuelle →
 * Manuelle » and look like a bug.
 */
export function meaningfulHistory<T extends { old_value: unknown; new_value: unknown }>(rows: T[]): T[] {
  return rows.filter(
    (r) => JSON.stringify(plainSettingValue(r.old_value) ?? null) !== JSON.stringify(plainSettingValue(r.new_value) ?? null),
  );
}

/** A shop is silent when it is active but sent nothing for more than this. */
export const SILENT_AFTER_DAYS = 14;

export type ShopState =
  | { kind: "off" }
  | { kind: "never" }
  | { kind: "quiet"; days: number }
  | { kind: "ok" };

export function shopState(
  shop: { is_active: boolean; last_order_at: string | null },
  now: Date = new Date(),
): ShopState {
  if (!shop.is_active) return { kind: "off" };
  if (!shop.last_order_at) return { kind: "never" };
  const days = Math.floor((now.getTime() - new Date(shop.last_order_at).getTime()) / 86_400_000);
  return days > SILENT_AFTER_DAYS ? { kind: "quiet", days } : { kind: "ok" };
}

/** whatsapp_send_window is stored as "HH-HH" (start before end, end ≤ 24). */
export function parseSendWindow(raw: string | null | undefined): { start: number; end: number } | null {
  if (!raw) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

export function formatSendWindow(start: number, end: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(start)}-${pad(end)}`;
}

/** How the confirmation target reads in a sentence: « 2 h » or « 90 min ». */
export function slaDuration(minutes: number): { unit: "h" | "min"; n: number } {
  return minutes > 0 && minutes % 60 === 0 ? { unit: "h", n: minutes / 60 } : { unit: "min", n: minutes };
}
