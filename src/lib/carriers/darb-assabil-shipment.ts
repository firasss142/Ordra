/**
 * Darb Assabil shipment projection — raw vendor record → OMS row shapes.
 *
 * PURE. No I/O, no Supabase, no fetch. `darb-sync-cycle.ts` persists what this
 * returns; keeping the transform pure is what makes the 153-field vendor payload
 * testable against a captured real record.
 *
 * WHY this module exists: until now the OMS read exactly one thing from a Darb
 * shipment — `status` — and threw the rest away on every poll. The carrier
 * actually tells us who is holding the parcel, their phone number, what the
 * courier wrote about the failed attempt, what we were really billed, and when
 * the COD money settled. All of that is here.
 *
 * Field names/nesting verified against live records on 2026-08-17 —
 * see docs/darb-assabil-sync.md §2 and scripts/probe-darb-shipments-list.ts.
 */

import { normalizeDarbStatus, type DarbSlug } from "./darb-assabil-statuses";

export interface DarbAttachment {
  url: string;
  mimeType: string | null;
  sizeInBytes: number | null;
  alt: string | null;
}

export interface DarbShipmentProjection {
  /** Vendor `_id` — the addressable key for status, modify and cancel. */
  darbId: string;
  /** Current human reference. Re-assigned by the carrier at booking. */
  reference: string | null;
  /** Creation-time `SH…` reference, preserved by the carrier as a `#tag`. */
  originalReference: string | null;
  slug: DarbSlug | null;
  rawStatus: string;

  // Who is holding it, and who to call.
  handlerName: string | null;
  handlerPhone: string | null;
  handlerAccountName: string | null;
  handlerAccountPhone: string | null;

  // Why it is where it is.
  latestRemark: string | null;
  latestRemarkAt: string | null;
  cancellationCause: string | null;
  delayedUntil: string | null;
  cancelCount: number | null;
  resendCount: number | null;

  // Money.
  billedShippingAmount: number | null;
  billedCurrency: string | null;
  shippingBreakdown: Record<string, number> | null;
  codOutstanding: number | null;
  deliveryWithdrawalAt: string | null;
  salesWithdrawalAt: string | null;

  // Where it is going.
  toCity: string | null;
  toArea: string | null;
  toAddress: string | null;
  toBranchGroup: string | null;
  toZoneCode: string | null;
  groupReference: string | null;

  // Everything else worth surfacing.
  serviceTitle: string | null;
  priority: number | null;
  notes: string | null;
  attachments: DarbAttachment[];
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Newest timeline timestamp — the delta-detection key. */
  latestEventAt: string | null;

  // Denormalized carrier comment thread, so a list view needs no join.
  latestComment: string | null;
  latestCommentAt: string | null;
  commentCount: number;
}

export interface DarbConversationRow {
  darbId: string;
  /** Vendor message `_id`, or a deterministic synthetic id. Uniqueness key. */
  messageId: string;
  message: string;
  authorName: string | null;
  authorPhone: string | null;
  postedAt: string | null;
}

export interface DarbTimelineRow {
  darbId: string;
  /** Vendor event `_id`, or a deterministic synthetic id. Uniqueness key. */
  eventId: string;
  type: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  /** The courier's own note — the most useful operational field Darb emits. */
  remarks: string | null;
  /**
   * The individual who performed the event. Populated ONLY by the
   * single-shipment GET — the LIST endpoint returns `createdBy` as a bare
   * ObjectId, so a bulk sweep leaves these null. Never fall back to
   * `accountPhone` here: that is a branch line, not a person.
   */
  actorId: string | null;
  actorName: string | null;
  actorPhone: string | null;
  /** Branch/office line the event was raised from (`timeline[].phone`). */
  accountPhone: string | null;
  occurredAt: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Trimmed string, or null. Empty string is absence, not a value. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** "fname lname" from a person-shaped object, collapsing internal whitespace. */
function personName(person: Record<string, unknown>): string | null {
  const parts = [person.fname, person.mname, person.lname]
    .map(str)
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ── Shipment ─────────────────────────────────────────────────────────

export function projectDarbShipment(record: unknown): DarbShipmentProjection | null {
  const r = asRecord(record);
  const darbId = str(r._id);
  if (!darbId) return null;

  const rawStatus = str(r.status) ?? "";
  const handler = asRecord(r.handler);
  const handlerAccount = asRecord(r.handlerAccount);
  const to = asRecord(r.to);
  const service = asRecord(r.service);

  // Billed shipping: the `shipping` line of the first invoice. A MISSING line is
  // null, never 0 — "we were not charged" and "we don't know" must stay distinct,
  // because this feeds cost reporting.
  const invoice = asRecord(asArray(r.invoices)[0]);
  const shippingItem = asArray(invoice.items)
    .map(asRecord)
    .find((item) => item.type === "shipping");
  const billedShippingAmount = shippingItem ? num(shippingItem.amount) : null;

  // Outstanding COD, in the shipment's own currency.
  const remaining = asRecord(asArray(r.remainings)[0]);

  // Darb re-references at booking but keeps the creation-time value as "#SH…".
  const originalReference =
    asArray(r.tags)
      .map(str)
      .find((t): t is string => !!t && /^#?SH\d+$/i.test(t))
      ?.replace(/^#/, "") ?? null;

  const conversation = projectDarbConversation(darbId, r);
  const latestComment = conversation.length > 0 ? conversation[conversation.length - 1] : null;

  const timeline = projectDarbTimeline(darbId, r);
  const withRemark = timeline.filter((e) => e.remarks !== null);
  const latest = withRemark.length > 0 ? withRemark[withRemark.length - 1] : null;
  const latestEventAt = timeline.reduce<string | null>((acc, e) => {
    if (!e.occurredAt) return acc;
    return acc === null || e.occurredAt > acc ? e.occurredAt : acc;
  }, null);

  return {
    darbId,
    reference: str(r.reference),
    originalReference,
    slug: normalizeDarbStatus(rawStatus),
    rawStatus,

    handlerName: personName(handler),
    handlerPhone: str(handler.phone),
    handlerAccountName: str(handlerAccount.name),
    handlerAccountPhone: str(handlerAccount.phone),

    latestRemark: latest?.remarks ?? null,
    latestRemarkAt: latest?.occurredAt ?? null,
    cancellationCause: str(r.cancellationCause),
    delayedUntil: str(r.delayedUntil),
    cancelCount: num(r.cancelCount),
    resendCount: num(r.resendCount),

    billedShippingAmount,
    billedCurrency: shippingItem
      ? (str(shippingItem.currency) ?? str(invoice.currency))
      : str(invoice.currency),
    shippingBreakdown: shippingItem
      ? ((asRecord(shippingItem.breakdown) as Record<string, number>) ?? null)
      : null,
    codOutstanding: num(remaining.amount),
    deliveryWithdrawalAt: str(r.deliveryWithdrawalAt),
    salesWithdrawalAt: str(r.salesWithdrawalAt),

    toCity: str(to.city),
    toArea: str(to.area),
    toAddress: str(to.address),
    toBranchGroup: str(r.toBranchGroup),
    toZoneCode: str(r.toZoneCode),
    groupReference: str(r.groupReference),

    serviceTitle: str(service.title),
    priority: num(r.priority),
    notes: str(r.notes),
    attachments: asArray(r.attachments)
      .map(asRecord)
      .map((a) => ({
        url: str(a.url) ?? "",
        mimeType: str(a.mimeType),
        sizeInBytes: num(a.sizeInBytes),
        alt: str(a.alt),
      }))
      .filter((a) => a.url.length > 0),
    completedAt: str(r.completedAt),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    latestEventAt,

    latestComment: latestComment?.message ?? null,
    latestCommentAt: latestComment?.postedAt ?? null,
    commentCount: conversation.length,
  };
}

/**
 * Project the carrier comment thread into append-only rows.
 *
 * Darb only populates `conversation` on ~8% of shipments (64 of 828 live), so a
 * single sampled record will make it look like the field doesn't exist. It does,
 * and it holds the customer-contact notes an agent most wants to see —
 * "مقفل اوخارج نطاق التغطية" (phone off / out of coverage), "مردش" (no answer),
 * "الزبون اجل الاستلام لي يوم الخميس" (customer postponed to Thursday).
 *
 * `createdBy` comes back as EITHER a populated person object OR a bare ObjectId
 * string, depending on whether the vendor expanded the reference. Both are
 * handled; a bare id yields a null author rather than a garbage name.
 */
export function projectDarbConversation(
  darbId: string,
  record: unknown,
): DarbConversationRow[] {
  const messages = asArray(asRecord(record).conversation);
  const rows: DarbConversationRow[] = [];
  messages.forEach((raw, index) => {
    const m = asRecord(raw);
    const message = str(m.message);
    if (!message) return; // an empty comment is not a comment
    const author = asRecord(m.createdBy); // {} when createdBy is a bare id string
    const postedAt = str(m.timestamp);
    rows.push({
      darbId,
      messageId: str(m._id) ?? `${darbId}:${postedAt ?? "no-ts"}:${index}`,
      message,
      authorName: personName(author),
      authorPhone: str(author.phone),
      postedAt,
    });
  });
  return rows;
}

// ── Timeline ─────────────────────────────────────────────────────────

/**
 * Project the inline timeline into append-only rows.
 *
 * Unlike the display path (`mapTimelineEvents` in darb-assabil-tracking.ts, which
 * drops `referenced` noise and collapses to Arabic), this keeps EVERY event and
 * BOTH languages — it is the stored audit trail, and dropping data at write time
 * is unrecoverable.
 */
export function projectDarbTimeline(darbId: string, record: unknown): DarbTimelineRow[] {
  const events = asArray(asRecord(record).timeline);
  return events.map((raw, index) => {
    const e = asRecord(raw);
    const description = asRecord(e.description);
    // `createdBy` is a populated person on the single-shipment GET, but a bare
    // ObjectId string on the LIST endpoint. asRecord() yields {} for the latter.
    const actor = asRecord(e.createdBy);
    const occurredAt = str(e.timestamp);
    return {
      darbId,
      // Index is part of the fallback id: two events can share a timestamp AND a
      // type, and a colliding key would silently drop one on upsert.
      eventId: str(e._id) ?? `${darbId}:${occurredAt ?? "no-ts"}:${index}`,
      type: str(e.type) ?? "info",
      descriptionAr: str(description.ar),
      descriptionEn: str(description.en),
      remarks: str(e.remarks),
      actorId: str(actor._id) ?? str(e.createdBy),
      actorName: personName(actor),
      actorPhone: str(actor.phone),
      accountPhone: str(e.phone),
      occurredAt,
    };
  });
}
