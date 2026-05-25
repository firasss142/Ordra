/**
 * Dexpress status taxonomy — the 19 known order statuses on the Dexpress portal.
 *
 * Each entry maps a numeric ID (the one that appears in /merchant/all-orders/{id}
 * URLs and in the `order_status` field of ajax-order-case responses) to:
 *  - a stable SCREAMING_SNAKE_CASE slug (for code + manager UI display)
 *  - the Arabic *timeline* label (used in tracking page header + timeline items
 *    + the `status_name` field of ajax-order-case responses)
 *  - the Arabic *sidebar* label (used in the left-nav `طلبات ...` menu items)
 *  - a `confirmed` flag distinguishing labels we've empirically observed from
 *    the ones inferred from the sidebar-prefix-stripping rule.
 *
 * Source: delivery_company_docs/Dexpress/tracking/dexpress-tracking-briefing.md
 * Probe confirmations: 2026-05-25 against tracking numbers 1343188, 1339630, 1341657.
 *
 * Graceful degradation: lookups return null on unknown input. The parser MUST
 * NEVER throw on an unrecognized status — surface it via the unknown-label
 * observability log instead.
 */

export type DexpressSlug =
  | "AT_CUSTOMER"
  | "BEING_PREPARED"
  | "IN_COMPANY"
  | "WILL_BE_SENT_TO_BRANCHES"
  | "EN_ROUTE_TO_BRANCHES"
  | "ARRIVED_AT_BRANCHES"
  | "OUT_FOR_DELIVERY"
  | "DELIVERY_POSTPONED"
  | "POSTPONED_WITH_COURIER"
  | "DELIVERED"
  | "PARTIALLY_DELIVERED"
  | "REPLACED"
  | "RECEIPT_REFUSED"
  | "RETURNING_VIA_COURIER"
  | "RETURNING_AT_BRANCHES"
  | "RETURNING_TO_COMPANY"
  | "RETURNED_AT_COMPANY"
  | "AWAITING_COURIER_SETTLEMENT"
  | "SENT_TO_COURIER";

export interface DexpressStatusEntry {
  id: number;
  slug: DexpressSlug;
  timelineLabel: string;
  sidebarLabel: string;
  confirmed: boolean;
}

export const DEXPRESS_STATUSES: readonly DexpressStatusEntry[] = [
  {
    id: 1,
    slug: "AT_CUSTOMER",
    timelineLabel: "عند العميل",
    sidebarLabel: "طلبات عند العميل",
    confirmed: true,
  },
  {
    id: 2,
    slug: "BEING_PREPARED",
    timelineLabel: "جارى التجهيز",
    sidebarLabel: "طلبات جارى التجهيز",
    confirmed: true,
  },
  {
    id: 3,
    slug: "IN_COMPANY",
    timelineLabel: "فى الشركة",
    sidebarLabel: "طلبات فى الشركة",
    confirmed: true,
  },
  {
    id: 4,
    slug: "WILL_BE_SENT_TO_BRANCHES",
    timelineLabel: "سترسل للفروع",
    sidebarLabel: "طلبات سترسل للفروع",
    confirmed: false,
  },
  {
    id: 5,
    slug: "EN_ROUTE_TO_BRANCHES",
    timelineLabel: "بالطريق للفروع",
    sidebarLabel: "طلبات بالطريق للفروع",
    confirmed: false,
  },
  {
    id: 6,
    slug: "ARRIVED_AT_BRANCHES",
    timelineLabel: "وصلت الفروع",
    sidebarLabel: "طلبات وصلت الفروع",
    confirmed: false,
  },
  {
    id: 7,
    slug: "OUT_FOR_DELIVERY",
    timelineLabel: "جارى التوصيل",
    sidebarLabel: "طلبات جارى التوصيل",
    confirmed: true,
  },
  {
    id: 8,
    slug: "DELIVERY_POSTPONED",
    timelineLabel: "مؤجلة التسليم",
    sidebarLabel: "طلبات مؤجلة التسليم",
    confirmed: false,
  },
  {
    id: 9,
    slug: "POSTPONED_WITH_COURIER",
    timelineLabel: "مؤجلة مع المندوب",
    sidebarLabel: "طلبات مؤجلة مع المندوب",
    confirmed: false,
  },
  {
    id: 10,
    slug: "DELIVERED",
    timelineLabel: "تم التسليم",
    sidebarLabel: "طلبات تم تسليمها",
    confirmed: true,
  },
  {
    id: 11,
    slug: "PARTIALLY_DELIVERED",
    timelineLabel: "تم تسليمها جزئياً",
    sidebarLabel: "طلبات تم تسليمها جزئياً",
    confirmed: false,
  },
  {
    id: 12,
    slug: "REPLACED",
    timelineLabel: "تم إستبدالها",
    sidebarLabel: "طلبات تم إستبدالها",
    confirmed: false,
  },
  {
    id: 13,
    slug: "RECEIPT_REFUSED",
    timelineLabel: "رفض إستلام",
    sidebarLabel: "طلبات رفض إستلام",
    confirmed: false,
  },
  {
    id: 14,
    slug: "RETURNING_VIA_COURIER",
    timelineLabel: "راجع لدى المندوب",
    sidebarLabel: "طلبات راجع لدى المندوب",
    confirmed: false,
  },
  {
    id: 15,
    slug: "RETURNING_AT_BRANCHES",
    timelineLabel: "راجعة بالفروع",
    sidebarLabel: "طلبات راجعة بالفروع",
    confirmed: false,
  },
  {
    id: 16,
    slug: "RETURNING_TO_COMPANY",
    timelineLabel: "راجع إلى الشركة",
    sidebarLabel: "طلبات راجع إلى الشركة",
    confirmed: false,
  },
  {
    id: 17,
    slug: "RETURNED_AT_COMPANY",
    timelineLabel: "راجع فى الشركة",
    sidebarLabel: "طلبات راجع فى الشركة",
    confirmed: false,
  },
  {
    id: 25,
    slug: "AWAITING_COURIER_SETTLEMENT",
    timelineLabel: "تسليم تحت تسويه المندوب",
    sidebarLabel: "طلبات تسليم تحت تسويه المندوب",
    confirmed: true,
  },
  {
    id: 29,
    slug: "SENT_TO_COURIER",
    timelineLabel: "إلى المندوب",
    sidebarLabel: "طلبات مرسلة للمندوب",
    confirmed: true,
  },
];

const TATWEEL = /ـ/g; // Arabic tatweel ـ — decorative kashida, ignore it

export function normalizeArabic(label: string): string {
  return label.replace(TATWEEL, "").replace(/\s+/g, " ").trim();
}

const BY_ID = new Map<number, DexpressStatusEntry>(
  DEXPRESS_STATUSES.map((e) => [e.id, e])
);

export function findStatusById(id: number): DexpressStatusEntry | null {
  if (!Number.isFinite(id)) return null;
  return BY_ID.get(id) ?? null;
}

const BY_NORMALIZED_LABEL = new Map<string, DexpressStatusEntry>();
for (const entry of DEXPRESS_STATUSES) {
  BY_NORMALIZED_LABEL.set(normalizeArabic(entry.timelineLabel), entry);
  BY_NORMALIZED_LABEL.set(normalizeArabic(entry.sidebarLabel), entry);
}

export function findStatusByLabel(rawLabel: string): DexpressStatusEntry | null {
  const normalized = normalizeArabic(rawLabel);
  if (!normalized) return null;
  return BY_NORMALIZED_LABEL.get(normalized) ?? null;
}

const BY_SLUG = new Map<DexpressSlug, DexpressStatusEntry>(
  DEXPRESS_STATUSES.map((e) => [e.slug, e]),
);

export function findStatusBySlug(slug: DexpressSlug): DexpressStatusEntry | null {
  return BY_SLUG.get(slug) ?? null;
}
