"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, MapPin, Phone } from "lucide-react";
import { isReferenceDeletedUpload, isBulkCallEligible, EDIT_BLOCKED_STATUSES, canDeleteDuplicateSiblingStatus } from "@/lib/order-permissions";
import { formatDateTime, formatLongDate, formatTime } from "@/lib/format";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { Button } from "@/components/ui/Button";
import { AttemptEtiquette } from "./AttemptEtiquette";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { RejectionReasonHover } from "./RejectionReasonHover";
import { AddressChangeNote } from "./AddressChangeNote";
import { getCarrierLogo } from "@/lib/carriers/carrier-logos";
import { bucketFor, type Bucket } from "@/lib/carriers/buckets";
import type { QueueOrder } from "@/types/queue";
import type { BucketKey } from "./QueueHeader";
import { highlightSegments, type HighlightSegment } from "@/lib/queue/highlight";
import type { ParsedQuery, SearchField } from "@/lib/queue/search";

interface OrderCardProps {
  order: QueueOrder;
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  maxAttempts?: number;
  focused?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** Bucket the card is currently rendered under — drives border tone. */
  selectedBucket?: BucketKey;
  /** When set (search active), matching substrings are highlighted. */
  highlightQuery?: ParsedQuery;
  /** Called after a duplicate sibling is deleted from the dialog, to revalidate the queue. */
  onMutate?: () => void;
}

/**
 * Renders `value`, wrapping the substrings that match the active search query in
 * <mark>. Short-circuits to plain text when no query is supplied, so normal
 * queue rendering is unaffected.
 */
function Highlighted({
  value,
  field,
  query,
}: {
  value: string;
  field: SearchField;
  query?: ParsedQuery;
}) {
  if (!query) return <>{value}</>;
  const segments: HighlightSegment[] = highlightSegments(value, query, field);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-amber-200/70 text-inherit rounded-[2px]">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A soft, pill-shaped status sign: tinted label on a quiet fill, no dot. The
 * tint+label carry the state at a glance; the contrast stays accessible without
 * a separate marker, for a calmer, more minimal look.
 */
function StatusSign({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-[0.01em] whitespace-nowrap",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

// Per-lifecycle-bucket pill colors. Anchored to the Dexpress timeline color
// story (see src/lib/carriers/dexpress/pipeline.ts) so the panel and the list
// speak the same visual language.
const BUCKET_PILL_CLASS: Record<Bucket, string> = {
  uploaded: "bg-[#F3E8FF] text-[#7C3AED]",     // purple — handed to carrier
  deposit: "bg-[#E0F2FE] text-[#0891B2]",      // cyan — in motion
  delivered: "bg-status-successBg text-status-success", // green — terminal success
  returned: "bg-rose-50 text-rose-700",        // rose — coming back
  cancelled: "bg-[#F1F5F9] text-[#475569]",    // slate — carrier-side cancellation
  rejected: "bg-status-criticalBg text-status-critical", // red — OMS-side rejection
};

// Per-bucket border tone. Fermées is per-status (rejected/uploaded/delivered
// get their own accent; everything else falls back to a neutral archive gray).
function bucketBorderClass(
  bucket: BucketKey | undefined,
  status: string,
  lifecycleBucket: Bucket | null,
): string {
  if (bucket === "fermees") {
    // Lifecycle bucket wins when present — keeps the border tone in sync with
    // the pill color for Dexpress orders.
    if (lifecycleBucket === "rejected") return "border border-[#DC2626]";
    if (lifecycleBucket === "uploaded") return "border border-[#7C3AED]";
    if (lifecycleBucket === "deposit") return "border border-[#0891B2]";
    if (lifecycleBucket === "delivered") return "border border-[#10B981]";
    if (lifecycleBucket === "returned") return "border border-rose-400";
    if (lifecycleBucket === "cancelled") return "border border-[#94A3B8]";
    if (status === "rejected") return "border border-[#DC2626]";
    if (status === "uploaded") return "border border-[#7C3AED]";
    if (status === "delivered") return "border border-[#D97706]";
    return "border border-agent-outline";
  }
  if (bucket === "nouveau") return "border border-[#1E3A5F]";
  if (bucket === "en_cours") return "border border-[#B07A00]";
  if (bucket === "confirme") return "border border-[#10B981]";
  return "border border-black/35";
}

function isAttemptOrCallback(status: string): boolean {
  return (
    status === "attempt_1" ||
    status === "attempt_2" ||
    status === "attempt_3" ||
    status === "callback_scheduled" ||
    status === "dispatch_scheduled"
  );
}

export const OrderCard = memo(function OrderCard({
  order,
  onOpenDetail,
  onCallTerminated,
  maxAttempts = 3,
  focused = false,
  isSelected = false,
  onToggleSelect,
  selectedBucket,
  highlightQuery,
  onMutate,
}: OrderCardProps) {
  const t = useTranslations("queue");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);

  const callbackDate = order.callback_time ? new Date(order.callback_time) : null;
  const callbackOverdue = now !== null && callbackDate !== null && callbackDate <= now;

  const dispatchDate = order.scheduled_dispatch_at
    ? new Date(order.scheduled_dispatch_at)
    : null;
  const dispatchOverdue =
    now !== null && dispatchDate !== null && dispatchDate <= now;

  // The "End call" affordance shows whenever the order is still in the agent's
  // hands: the call pool (new/assigned/attempts/callbacks), confirmed, or a
  // scheduled dispatch — plus uploads whose carrier reference was deleted
  // (treated like confirmed). It is hidden on terminal and carrier-locked
  // statuses (rejected, normal uploaded, dispatched, …).
  const TERMINAL = new Set([
    "delivered",
    "returned",
    "rejected",
    "deleted",
    "cancelled",
  ]);
  const showEndCall =
    !TERMINAL.has(order.status) &&
    (isReferenceDeletedUpload(order) || !EDIT_BLOCKED_STATUSES.has(order.status));

  const truncatedNote =
    order.customer_note && order.customer_note.length > 60
      ? order.customer_note.slice(0, 60) + "…"
      : order.customer_note;

  function getCustomerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Status pill style: attempts/callbacks are handled by AttemptEtiquette.
  // Every other status gets a labelled pill.
  //
  // For closed orders we consult bucketFor() first — it maps the (OMS status,
  // carrier, Dexpress slug) triple to one of 5 lifecycle buckets so the pill
  // reflects what the carrier portal actually says about the order. Falls
  // through to the legacy OMS-status pills for non-Dexpress carriers and for
  // active-queue statuses (pending, confirmed, ...).
  //
  // Reference-deleted uploads stay on the "À réuploader" warning pill — that
  // signals an action the AGENT must take, which overrides the carrier-side
  // bucket view. Bucket spec: plans/dexpress-list-status-bucket.md.
  const bucket: Bucket | null = bucketFor({
    status: order.status,
    carrierCode: order.carrier_code,
    dexpressStatusSlug: order.dexpress_status_slug,
    dexpressStatusAccepted: order.dexpress_status_accepted,
    carrierStatusSlug: order.carrier_status_slug,
  });

  const statusPill = (() => {
    if (isReferenceDeletedUpload(order)) {
      return {
        label: t("statusReferenceDeleted"),
        className: "bg-status-warningBg text-status-warning",
      };
    }
    if (bucket) {
      return {
        label: ts(`bucket.${bucket}` as Parameters<typeof ts>[0]),
        className: BUCKET_PILL_CLASS[bucket],
      };
    }
    if (order.status === "confirmed") {
      return {
        label: ts("confirmed"),
        className: "bg-agent-primary-container/20 text-agent-on-primary-container",
      };
    }
    if (order.status === "pending" || order.status === "assigned") {
      return {
        label: ts(order.status as Parameters<typeof ts>[0]),
        // New orders read as "fresh" with the soft blue nouveau accent.
        className: "bg-[#1E3A5F]/10 text-[#1E3A5F]",
      };
    }
    return null;
  })();

  const cardBorderClass = bucketBorderClass(selectedBucket, order.status, bucket);
  const displayCurrency = formatDisplayCurrencyCode(order.currency, order.market_id);

  return (
    <div
      data-order-id={order.id}
      data-focused={focused || undefined}
      onClick={() => onOpenDetail(order.id)}
      data-selected={isSelected || undefined}
      className={[
        "group relative cursor-pointer agent-card-hover",
        "rounded-xl px-3 py-1.5",
        "bg-agent-surface",
        cardBorderClass,
        isSelected ? "ring-2 ring-black/20" : "",
      ].join(" ")}
    >
      {/* Bulk-select checkbox — only on orders that can join a "Start calls"
          batch, so the bulk bar never queues an order the call sheet can't act
          on (confirmed / uploaded / dispatched / closed have no checkbox). */}
      {onToggleSelect && isBulkCallEligible(order) && (
        <button
          type="button"
          role="checkbox"
          data-checkbox
          aria-checked={isSelected}
          aria-label={t("selectOrder")}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(order.id);
          }}
          className={[
            "absolute top-3 start-3 z-10",
            "inline-flex items-center justify-center",
            "h-[18px] w-[18px] rounded-[5px] border",
            "transition-all duration-fast",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-agent-primary/40 focus-visible:ring-offset-1",
            isSelected
              ? "bg-agent-primary border-agent-primary opacity-100"
              : "bg-agent-surface border-agent-outline opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-agent-on-surface [[data-has-selection]_&]:opacity-100",
          ].join(" ")}
        >
          {isSelected && (
            <Check size={12} strokeWidth={3} className="text-white" aria-hidden="true" />
          )}
        </button>
      )}

      <div className="flex items-center gap-3 sm:gap-5">
        {/* Leading visual — product image, falling back to customer initials.
            A small ×N quantity badge sits on the corner so multi-unit orders
            read at a glance (always shown, incl. ×1). */}
        <span className="relative shrink-0">
          {order.product_image_url ? (
            <span className="flex items-center justify-center w-9 h-9 rounded-lg overflow-hidden bg-agent-surface-high border border-agent-outline-variant">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={order.product_image_url}
                alt={order.product_name}
                width={36}
                height={36}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-agent-surface-high border border-agent-outline-variant text-agent-primary text-[13px] font-bold"
            >
              {getCustomerInitials(order.customer_name)}
            </span>
          )}
          <span
            aria-label={`×${order.quantity}`}
            className="absolute -bottom-1 -end-1 min-w-[16px] h-[16px] px-1 inline-flex items-center justify-center rounded-full bg-agent-on-surface text-agent-surface text-[10px] font-bold tabular-nums leading-none ring-1 ring-agent-surface"
          >
            ×{new Intl.NumberFormat(locale).format(order.quantity)}
          </span>
        </span>

        {/* Customer name + badges. On mobile this is a column: the name takes
            the full width on its own line, and a compact status + date row sits
            underneath it. On desktop it stays a single inline row and the
            status/date render as separate trailing columns (below). */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="min-w-0 truncate text-[14px] font-bold text-agent-on-surface">
              <Highlighted value={order.customer_name} field="name" query={highlightQuery} />
            </span>
            {order.status !== "deleted" &&
              (order.repeat_kind !== "none" ||
                (order.is_potential_duplicate && order.is_duplicate_anchor)) && (
              <span className="inline-flex shrink-0 items-center gap-1">
                {order.repeat_kind !== "none" && (
                  <RepeatBuyerBadge
                    source="order"
                    sourceId={order.id}
                    repeatKind={order.repeat_kind}
                    priorOrderCount={order.prior_order_count}
                    priorLeadCount={order.prior_lead_count}
                    priorRejectedCount={order.prior_rejected_count}
                    currencyCode={displayCurrency}
                    customerPhone={order.customer_phone}
                    anchorOrderId={order.id}
                    anchorStatus={order.status}
                    anchorCreatedAt={order.created_at}
                    anchorTotalPrice={order.total_price}
                    anchorProductName={order.product_name}
                    anchorProductImageUrl={order.product_image_url}
                    anchorCustomerName={order.customer_name}
                    anchorCustomerAddress={order.customer_address}
                    anchorCustomerCity={order.customer_city}
                  />
                )}
                {order.is_potential_duplicate && order.is_duplicate_anchor && (
                  <DuplicateOrderBadge
                    count={order.duplicate_count}
                    siblings={order.duplicate_siblings}
                    hasUploadedSibling={order.has_uploaded_sibling}
                    anchorOrderId={order.id}
                    anchorStatus={order.status}
                    anchorCreatedAt={order.created_at}
                    anchorTotalPrice={order.total_price}
                    anchorProductName={order.product_name}
                    anchorProductImageUrl={order.product_image_url}
                    anchorCustomerName={order.customer_name}
                    anchorCustomerAddress={order.customer_address}
                    anchorCustomerCity={order.customer_city}
                    currencyCode={displayCurrency}
                    canDelete={canDeleteDuplicateSiblingStatus(order.status)}
                    onChange={onMutate}
                  />
                )}
              </span>
            )}
          </div>

          {/* Product identity — muted secondary line under the customer name
              (who → what). Variant folds in here, so there's no separate variant
              column. */}
          {order.product_name && (
            <span className="text-[12px] text-agent-on-surface-variant truncate leading-tight">
              {order.product_name}
              {order.variant_label ? ` · ${order.variant_label}` : ""}
            </span>
          )}

          {/* Mobile-only status + date sub-row (hidden from sm: up, where the
              status/date render as their own trailing columns instead). */}
          <div className="flex sm:hidden items-center gap-2 min-w-0">
            {isAttemptOrCallback(order.status) ? (
              <AttemptEtiquette
                status={order.status}
                attemptsCount={order.attempt_count ?? 0}
                maxAttempts={maxAttempts}
                callbackAt={order.callback_time}
                scheduledDispatchAt={order.scheduled_dispatch_at}
                scheduledDispatchAuto={order.scheduled_dispatch_auto}
                now={now ?? undefined}
                compact
              />
            ) : statusPill ? (
              order.status === "rejected" ? (
                <RejectionReasonHover
                  reason={order.rejection_reason}
                  note={order.rejection_note}
                >
                  <StatusSign label={statusPill.label} className={`${statusPill.className} !text-[10px] !px-2 !py-0.5`} />
                </RejectionReasonHover>
              ) : (
                <StatusSign label={statusPill.label} className={`${statusPill.className} !text-[10px] !px-2 !py-0.5`} />
              )
            ) : null}
            <span className="text-[10.5px] text-agent-on-surface-variant/80 tabular-nums truncate shrink-0">
              {formatLongDate(order.created_at, locale)}
            </span>
          </div>
        </div>

        {/* City */}
        {order.customer_city && (
          <span className="hidden md:inline-flex items-center gap-1 text-[12.5px] text-agent-on-surface-variant max-w-[120px] shrink-0">
            <MapPin size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            <span className="truncate">
              <Highlighted value={order.customer_city} field="city" query={highlightQuery} />
            </span>
          </span>
        )}

        {/* Created date + time — a single quiet line, icon-free, centered in its
            own column (e.g. "21 mai 2026, 14:30"). Minimal by design: the
            elapsed-since-assignment detail lives in the order panel, not here. */}
        <span
          className="hidden md:block shrink-0 text-center text-[12px] text-agent-on-surface-variant tabular-nums whitespace-nowrap"
          aria-label={t("createdAt", { date: formatLongDate(order.created_at, locale) })}
        >
          {formatLongDate(order.created_at, locale)}, {formatTime(order.created_at, locale)}
        </span>

        {/* Carrier brand logo — shown once a carrier is assigned (uploaded
            onward) so the agent sees which delivery company holds the order.
            Logo-only; a neutral text chip stands in when the carrier has no
            asset yet. */}
        {order.carrier_code && (
          <span
            className="shrink-0 hidden sm:inline-flex items-center"
            title={order.carrier_name ?? order.carrier_code}
          >
            {getCarrierLogo(order.carrier_code) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getCarrierLogo(order.carrier_code)!}
                alt={order.carrier_name ?? order.carrier_code}
                width={20}
                height={20}
                loading="lazy"
                decoding="async"
                className="h-5 w-auto object-contain"
              />
            ) : (
              <span
                aria-label={order.carrier_name ?? order.carrier_code}
                className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-agent-surface-high border border-agent-outline-variant text-[10px] font-bold uppercase text-agent-on-surface-variant"
              >
                {(order.carrier_name ?? order.carrier_code).slice(0, 3)}
              </span>
            )}
          </span>
        )}

        {/* Status sign — desktop trailing column. On mobile the status renders
            in the name's sub-row instead (see above), so hide it here below sm. */}
        <div className="shrink-0 hidden sm:flex items-center">
          {isAttemptOrCallback(order.status) ? (
            <AttemptEtiquette
              status={order.status}
              attemptsCount={order.attempt_count ?? 0}
              maxAttempts={maxAttempts}
              callbackAt={order.callback_time}
              scheduledDispatchAt={order.scheduled_dispatch_at}
              scheduledDispatchAuto={order.scheduled_dispatch_auto}
              now={now ?? undefined}
            />
          ) : statusPill ? (
            order.status === "rejected" ? (
              <RejectionReasonHover
                reason={order.rejection_reason}
                note={order.rejection_note}
              >
                <StatusSign label={statusPill.label} className={statusPill.className} />
              </RejectionReasonHover>
            ) : (
              <StatusSign label={statusPill.label} className={statusPill.className} />
            )
          ) : null}
        </div>

        {/* Price — trailing edge, the standout figure on the card */}
        <div className="shrink-0 flex items-baseline gap-1 ps-3 ms-1 border-s border-agent-outline-variant/50">
          <span className="text-[22px] font-extrabold text-agent-primary tabular-nums leading-none">
            {order.total_price}
          </span>
          <span className="text-[12px] font-bold text-agent-on-surface-variant">
            {displayCurrency}
          </span>
        </div>

        {/* Mobile call-ended action — sits next to the price in the main row so
            the card stays short (no extra bottom row). Desktop renders the
            labelled button below instead. */}
        {showEndCall && (
          <Button
            size="sm"
            aria-label={t("callEnded")}
            className="sm:hidden shrink-0 w-8 px-0 gap-0 ms-1"
            onClick={(e) => {
              e.stopPropagation();
              onCallTerminated(order.id);
            }}
          >
            <Phone size={14} strokeWidth={2.25} aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Optional supporting row — address change, customer note, attempts overdue */}
      {(order.last_known_address ||
        truncatedNote ||
        (order.status === "callback_scheduled" && callbackOverdue) ||
        (order.status === "dispatch_scheduled" && dispatchOverdue)) && (
        <div className="mt-2 ps-[52px] flex flex-col gap-1.5">
          {order.last_known_address && (
            <AddressChangeNote
              currentAddress={order.customer_address}
              lastKnownAddress={order.last_known_address}
            />
          )}
          {order.status === "callback_scheduled" && callbackOverdue && callbackDate && (
            <span className="text-[12px] font-semibold text-agent-error">
              {t("callbackAt", { time: formatDateTime(order.callback_time!, locale) })}
            </span>
          )}
          {order.status === "dispatch_scheduled" && dispatchOverdue && dispatchDate && (
            <span className="text-[12px] font-semibold text-agent-error">
              {t("dispatchOverdue")} · {formatDateTime(order.scheduled_dispatch_at!, locale)}
            </span>
          )}
          {truncatedNote && (
            <span className="text-[12px] text-agent-on-surface-variant italic">{truncatedNote}</span>
          )}
        </div>
      )}

      {/* Call-ended action — desktop labelled button on its own row. On mobile
          the icon-only button lives in the main row next to the price instead. */}
      {showEndCall && (
        <div className="hidden sm:flex justify-end mt-2">
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onCallTerminated(order.id);
            }}
          >
            {t("callEnded")}
          </Button>
        </div>
      )}
    </div>
  );
});
