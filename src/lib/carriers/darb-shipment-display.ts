/**
 * Presentation helpers for the Darb Assabil shipment panel.
 *
 * PURE — no I/O, no React. Keeps the decisions that are easy to get subtly
 * wrong (which events to hide, who to call, how to read the fee breakdown)
 * testable and in one place, rather than inline in JSX across three surfaces.
 *
 * Source of the vocabulary: docs/darb-assabil-sync.md §2.
 */

export interface DarbCancellationCause {
  slug: string;
  labelEn: string;
  labelAr: string;
}

/**
 * The eight causes the vendor documents. All are covered, not just the ones
 * observed live — a cause we have not seen yet must still render as words
 * rather than a raw slug.
 */
export const DARB_CANCELLATION_CAUSES: readonly DarbCancellationCause[] = [
  { slug: "not-needed", labelEn: "No longer needed", labelAr: "لم تعد مطلوبة" },
  { slug: "fake", labelEn: "Fake order", labelAr: "طلب وهمي" },
  { slug: "mistake-by-store", labelEn: "Store error", labelAr: "خطأ من المتجر" },
  { slug: "replacement", labelEn: "Replacement", labelAr: "استبدال" },
  { slug: "3-days-no-response", labelEn: "No answer for 3 days", labelAr: "لا يرد منذ 3 أيام" },
  { slug: "incorrect-product-specs", labelEn: "Wrong product details", labelAr: "مواصفات المنتج غير صحيحة" },
  { slug: "cancelled-by-the-customer", labelEn: "Cancelled by customer", labelAr: "ألغاها الزبون" },
  { slug: "other", labelEn: "Other", labelAr: "أخرى" },
] as const;

const CAUSE_BY_SLUG = new Map(DARB_CANCELLATION_CAUSES.map((c) => [c.slug, c]));

/** Resolve a raw cancellationCause. Unknown or absent → null, never throws. */
export function findCancellationCause(
  slug: string | null | undefined,
): DarbCancellationCause | null {
  if (!slug) return null;
  return CAUSE_BY_SLUG.get(slug.trim()) ?? null;
}

export interface ShippingLeg {
  key: string;
  amount: number;
}

/**
 * The carrier's own fee breakdown, as ordered non-zero legs.
 *
 * Zero legs are dropped: `pickFromDoor: 0` means that service wasn't used, and
 * listing it as a 0 line implies it was itemised and free. Ordering is
 * largest-first so the dominant cost reads immediately.
 */
export function shippingCostLegs(
  breakdown: Record<string, number> | null | undefined,
): ShippingLeg[] {
  if (!breakdown || typeof breakdown !== "object") return [];
  return Object.entries(breakdown)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([key, amount]) => ({ key, amount: amount as number }))
    .sort((a, b) => b.amount - a.amount);
}

export interface DarbTimelineLike {
  event_id: string;
  type: string;
  description_ar: string | null;
  description_en: string | null;
  remarks: string | null;
  actor_name: string | null;
  actor_phone: string | null;
  occurred_at: string | null;
}

/**
 * Carrier bookkeeping event types. Darb never gives these a real translation —
 * `description.ar` comes back as raw English like "Box Reference the order by
 * BX18KF" — so they are noise in a panel while remaining valuable in the stored
 * audit trail (darb_timeline_events keeps everything).
 */
const BOOKKEEPING_TYPES: ReadonlySet<string> = new Set(["referenced"]);

/**
 * Events worth showing, newest first.
 *
 * A bookkeeping event that carries a courier `remarks` is KEPT: a note written
 * by a person always outranks the event type it happens to be attached to.
 */
export function displayTimeline(events: DarbTimelineLike[]): DarbTimelineLike[] {
  if (!Array.isArray(events)) return [];
  return events
    .filter((e) => !BOOKKEEPING_TYPES.has(e.type) || !!e.remarks)
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));
}

export interface HolderFields {
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  handler_account_phone: string | null;
}

export interface CurrentHolder {
  name: string;
  phone: string | null;
  /** The office behind the courier — null when the office IS the holder. */
  office: string | null;
  /** True when no courier is assigned yet and this is the branch, not a person. */
  isOfficeFallback: boolean;
}

/**
 * Who to call about this parcel right now.
 *
 * Darb assigns an individual courier only once a shipment is booked; before
 * that the branch office is the contact. The distinction is surfaced via
 * `isOfficeFallback` so the UI never labels an office as a person.
 */
export function currentHolder(fields: HolderFields): CurrentHolder | null {
  if (fields.handler_name) {
    return {
      name: fields.handler_name,
      phone: fields.handler_phone,
      office: fields.handler_account_name,
      isOfficeFallback: false,
    };
  }
  if (fields.handler_account_name) {
    return {
      name: fields.handler_account_name,
      phone: fields.handler_account_phone,
      office: null,
      isOfficeFallback: true,
    };
  }
  return null;
}

/**
 * Semantic hue for carrier-side state.
 *
 * Maps to the OMS console's existing semantic tokens, NOT to new colours. The
 * design system reserves `--oms-info` (teal) for carrier-side state precisely so
 * phase 2 can never be mistaken for phase 1's violet, and pairs amber/red/green
 * with warn/bad/ok. Colour here therefore encodes meaning — it is not decoration.
 */
export type DarbHue = "neutral" | "info" | "warn" | "ok" | "bad";

const STATUS_HUE: Record<string, DarbHue> = {
  completed: "ok",
  returned: "bad",
  cancelled: "bad",
  delayed: "warn",
  returning: "warn",
  processing: "info",
  "on-branch": "info",
  released: "info",
  resent: "info",
  booked: "info",
  // `pending` is deliberately neutral: created but not yet booked is not news.
  pending: "neutral",
};

export function statusHue(slug: string | null | undefined): DarbHue {
  if (!slug) return "neutral";
  return STATUS_HUE[slug] ?? "neutral";
}

const EVENT_HUE: Record<string, DarbHue> = {
  rejected: "bad",
  cancelled: "bad",
  "cancel-confirmed": "bad",
  danger: "bad",
  returned: "bad",
  delayed: "warn",
  warning: "warn",
  returning: "warn",
  completed: "ok",
  "partially-completed": "ok",
  accepted: "ok",
  "payment-received": "ok",
  assigned: "info",
  released: "info",
  shipped: "info",
  arrived: "info",
  booked: "info",
  waiting: "info",
};

export function eventHue(type: string | null | undefined): DarbHue {
  if (!type) return "neutral";
  return EVENT_HUE[type] ?? "neutral";
}

/**
 * First letter of a person's name, for an avatar chip.
 *
 * Uses the spread operator rather than `[0]` so an Arabic grapheme or an emoji
 * in a courier's display name (they occur — "حسين بومعيوف الحاسي👋") yields a
 * whole character instead of half a surrogate pair.
 */
export function initialOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const first = [...trimmed][0];
  return first ? first.toLocaleUpperCase() : null;
}
