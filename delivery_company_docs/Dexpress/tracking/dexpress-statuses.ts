/**
 * Dexpress order status taxonomy.
 *
 * Reverse-engineered from /merchant/all-orders/{id} URLs and from the
 * tracking page (/merchant/track-order/{id}) timeline labels.
 *
 * Two label vocabularies coexist in the Dexpress portal:
 *   - "sidebar" labels:  shown in the left-nav list ("طلبات في الشركة")
 *   - "timeline" labels: shown in the tracking page header + timeline items ("في الشركة")
 *
 * They map 1:1 to the same underlying numeric status ID (the one in the
 * /merchant/all-orders/{N} URL), but the strings differ. We resolve both.
 *
 * IDs 25 and 29 are out of sequence — added later by Dexpress, presumably.
 *
 * If a future status appears that isn't in this map, the tracking parser
 * returns the raw Arabic string with statusId/slug=null rather than throwing.
 * That way the integration degrades gracefully; we just add a row here.
 */

export interface DexpressStatus {
  /** Numeric ID used in /merchant/all-orders/{id} URLs and ajax-order-case responses */
  id: number;
  /** Stable English slug for use in our own DB / API output */
  slug: string;
  /** Label as it appears on the tracking page (timeline items + current-status header) */
  timelineLabel: string;
  /** Label as it appears in the left-nav sidebar */
  sidebarLabel: string;
  /** Optional: notes about meaning, when ambiguous */
  notes?: string;
}

export const DEXPRESS_STATUSES: DexpressStatus[] = [
  {
    id: 1,
    slug: "AT_CUSTOMER",
    timelineLabel: "عند العميل",
    sidebarLabel: "طلبات عند العميل",
    notes: "Order is with the merchant's customer — first stage before pickup.",
  },
  {
    id: 2,
    slug: "BEING_PREPARED",
    timelineLabel: "جارى التجهيز",
    sidebarLabel: "طلبات جارى تجهيزها",
  },
  {
    id: 3,
    slug: "IN_COMPANY",
    timelineLabel: "فى الشركة",
    sidebarLabel: "طلبات فى الشركة",
    notes: "Picked up by Dexpress, sitting at the main warehouse.",
  },
  {
    id: 4,
    slug: "WILL_BE_SENT_TO_BRANCHES",
    timelineLabel: "سترسل للفروع",
    sidebarLabel: "طلبات سترسل للفروع",
    notes: "Timeline label unconfirmed — guess based on sidebar wording.",
  },
  {
    id: 5,
    slug: "EN_ROUTE_TO_BRANCHES",
    timelineLabel: "بالطريق للفروع",
    sidebarLabel: "طلبات بالطريق للفروع",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 6,
    slug: "ARRIVED_AT_BRANCHES",
    timelineLabel: "وصلت الفروع",
    sidebarLabel: "طلبات وصلت الفروع",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 7,
    slug: "OUT_FOR_DELIVERY",
    timelineLabel: "جارى التوصيل",
    sidebarLabel: "طلبات جارى توصيلها",
  },
  {
    id: 8,
    slug: "DELIVERY_POSTPONED",
    timelineLabel: "مؤجلة التسليم",
    sidebarLabel: "طلبات مؤجلة التسليم",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 9,
    slug: "POSTPONED_WITH_COURIER",
    timelineLabel: "مؤجلة مع المندوب",
    sidebarLabel: "مؤجلة مع المندوب",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 10,
    slug: "DELIVERED",
    timelineLabel: "تم التسليم",
    sidebarLabel: "طلبات تم تسليمها",
  },
  {
    id: 11,
    slug: "PARTIALLY_DELIVERED",
    timelineLabel: "تم تسليمها جزئياً",
    sidebarLabel: "طلبات تسليمها جزئياً",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 12,
    slug: "REPLACED",
    timelineLabel: "تم إستبدالها",
    sidebarLabel: "طلبات تم إستبدالها",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 13,
    slug: "RECEIPT_REFUSED",
    timelineLabel: "رفض إستلام",
    sidebarLabel: "طلبات رفض إستلام",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 14,
    slug: "RETURNING_VIA_COURIER",
    timelineLabel: "راجع لدى المندوب",
    sidebarLabel: "راجع لــــــدى المندوب",
    notes: "Sidebar label includes decorative tatweel chars; we strip them when matching.",
  },
  {
    id: 15,
    slug: "RETURNING_AT_BRANCHES",
    timelineLabel: "راجعة بالفروع",
    sidebarLabel: "طلبات راجعة بالفروع",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 16,
    slug: "RETURNING_TO_COMPANY",
    timelineLabel: "راجع إلى الشركة",
    sidebarLabel: "طلبات راجع إلى الشركة",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 17,
    slug: "RETURNED_AT_COMPANY",
    timelineLabel: "راجع فى الشركة",
    sidebarLabel: "طلبات راجع فى الشركة",
    notes: "Timeline label unconfirmed.",
  },
  {
    id: 25,
    slug: "AWAITING_COURIER_SETTLEMENT",
    timelineLabel: "تسليم تحت تسويه المندوب",
    sidebarLabel: "بإنتظار تسوية المندوب",
    notes:
      "Out-of-sequence ID. Confirmed from timeline of delivered order 1138841.",
  },
  {
    id: 29,
    slug: "SENT_TO_COURIER",
    timelineLabel: "إلى المندوب",
    sidebarLabel: "طلبات مرسلة للمندوب",
    notes: "Out-of-sequence ID. Confirmed from timeline of order 1339635.",
  },
  // The portal also has a "pending-orders" route (no numeric ID in URL) and
  // a "rejected-orders" route. Their numeric IDs in the underlying system
  // are unknown to us; if we ever see them in ajax-order-case responses
  // we'll add entries here.
];

/** Lookup index — ID → status entry. */
const BY_ID = new Map<number, DexpressStatus>(
  DEXPRESS_STATUSES.map((s) => [s.id, s])
);

/**
 * Normalize an Arabic label for fuzzy matching. Dexpress sometimes adds
 * decorative tatweel characters (ـ), variable whitespace, and stray
 * trailing/leading spaces. We strip all of that.
 */
function normalizeArabic(s: string): string {
  return s
    .replace(/ـ+/g, "")     // tatweel
    .replace(/\s+/g, " ")   // collapse whitespace
    .trim();
}

/** Build a label → status map from both vocabularies for fast lookup. */
const BY_LABEL = new Map<string, DexpressStatus>();
for (const s of DEXPRESS_STATUSES) {
  BY_LABEL.set(normalizeArabic(s.timelineLabel), s);
  BY_LABEL.set(normalizeArabic(s.sidebarLabel), s);
}

export function findStatusById(id: number): DexpressStatus | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Resolve a label (timeline-style OR sidebar-style) to a status entry.
 * Returns null if unknown — caller is expected to handle that case by
 * returning the raw label string with id/slug = null.
 */
export function findStatusByLabel(label: string): DexpressStatus | null {
  return BY_LABEL.get(normalizeArabic(label)) ?? null;
}
