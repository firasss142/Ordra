/**
 * Darb Assabil status taxonomy — the 11 documented shipment statuses.
 *
 * Unlike Dexpress (whose statuses are reverse-engineered from scraped HTML),
 * Darb exposes a clean, documented status enum on its API. The "slug" we cache
 * IS the carrier's own status string — no numeric-id indirection needed.
 *
 * Source: delivery_company_docs/Darb Assabil/INTEGRATION_GUIDE.md §6.
 *
 * Graceful degradation: normalizeDarbStatus returns null on unknown input. The
 * parser MUST NEVER throw on an unrecognized status — surface it via the
 * unknown-status observability log instead (same rule as Dexpress).
 */

export type DarbSlug =
  | "pending"
  | "booked"
  | "processing"
  | "on-branch"
  | "released"
  | "resent"
  | "delayed"
  | "returning"
  | "completed"
  | "returned"
  | "cancelled";

export interface DarbStatusEntry {
  slug: DarbSlug;
  /** English meaning (INTEGRATION_GUIDE §6). */
  labelEn: string;
  /** Arabic label for the Libya (RTL) market UI. */
  labelAr: string;
}

export const DARB_STATUSES: readonly DarbStatusEntry[] = [
  { slug: "pending", labelEn: "Created", labelAr: "تم الإنشاء" },
  { slug: "booked", labelEn: "Booked", labelAr: "تم الحجز" },
  { slug: "processing", labelEn: "Processing", labelAr: "قيد التجهيز" },
  { slug: "on-branch", labelEn: "At branch", labelAr: "في الفرع" },
  { slug: "released", labelEn: "Out for delivery", labelAr: "خرجت للتوصيل" },
  { slug: "resent", labelEn: "Re-attempted", labelAr: "إعادة محاولة" },
  { slug: "delayed", labelEn: "Delayed", labelAr: "مؤجلة" },
  { slug: "returning", labelEn: "Returning", labelAr: "قيد الإرجاع" },
  { slug: "completed", labelEn: "Delivered", labelAr: "تم التسليم" },
  { slug: "returned", labelEn: "Returned", labelAr: "تم الإرجاع" },
  { slug: "cancelled", labelEn: "Cancelled", labelAr: "ملغاة" },
] as const;

const SLUG_SET: ReadonlySet<string> = new Set(DARB_STATUSES.map((s) => s.slug));

/**
 * Normalize a raw carrier status string to a known DarbSlug, or null.
 * Case-insensitive, whitespace-trimmed. Unknown → null (no throw).
 */
export function normalizeDarbStatus(
  raw: string | null | undefined,
): DarbSlug | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  return SLUG_SET.has(cleaned) ? (cleaned as DarbSlug) : null;
}

/** Look up a taxonomy entry by slug (for label rendering). */
export function findDarbStatus(slug: string | null): DarbStatusEntry | null {
  if (!slug) return null;
  return DARB_STATUSES.find((s) => s.slug === slug) ?? null;
}
