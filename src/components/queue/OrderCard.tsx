"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Check, CalendarDays, MapPin, Clock } from "lucide-react";
import { isReferenceDeletedUpload, isBulkCallEligible, EDIT_BLOCKED_STATUSES, canDeleteDuplicateSiblingStatus } from "@/lib/order-permissions";
import { formatDateTime, formatLongDate, formatTime } from "@/lib/format";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { Button } from "@/components/ui/Button";
import { AttemptEtiquette } from "./AttemptEtiquette";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { RejectionReasonHover } from "./RejectionReasonHover";
import { AddressChangeNote } from "./AddressChangeNote";
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
 * A pill-shaped status sign: a small filled dot + label. The dot pairs the
 * color with the text so the state reads at a glance and stays accessible
 * (color is never the only signal).
 */
function StatusSign({
  label,
  dot,
  className,
}: {
  label: string;
  dot?: string;
  className: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-[11px] font-bold tracking-[0.04em] whitespace-nowrap",
        className,
      ].join(" ")}
    >
      {dot && (
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      )}
      {label}
    </span>
  );
}

// Per-bucket border tone. Fermées is per-status (rejected/uploaded/delivered
// get their own accent; everything else falls back to a neutral archive gray).
function bucketBorderClass(
  bucket: BucketKey | undefined,
  status: string,
): string {
  if (bucket === "fermees") {
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

  // A compact elapsed value (e.g. "22j", "3h", "15min") — no "il y a" prefix,
  // shown in parentheses next to the date.
  function elapsedLabel(assignedAt: string): string {
    const diffMs = Date.now() - new Date(assignedAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);
    if (diffMins < 60) {
      return t("elapsedUnits.minutes", { count: formatCount(diffMins) });
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return t("elapsedUnits.hours", { count: formatCount(diffHours) });
    }
    return t("elapsedUnits.days", { count: formatCount(Math.floor(diffHours / 24)) });
  }

  function getCustomerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Status pill style: attempts/callbacks are handled by AttemptEtiquette.
  // Every other status gets a labelled pill with a leading status dot so the
  // order's state is spottable at a glance, at any breakpoint.
  const statusPill = (() => {
    // A reference-deleted upload is back in the agent's hands — surface it as
    // "À réuploader" rather than the carrier-locked "Téléchargé".
    if (isReferenceDeletedUpload(order)) {
      return {
        label: t("statusReferenceDeleted"),
        className:
          "bg-status-warningBg text-status-warning border border-status-warning/30",
        dot: "bg-status-warning",
      };
    }
    if (order.status === "confirmed") {
      return {
        label: ts("confirmed"),
        className:
          "bg-agent-primary-container/15 text-agent-on-primary-container border border-agent-primary/20",
        dot: "bg-agent-primary",
      };
    }
    if (order.status === "uploaded") {
      return {
        label: ts("uploaded"),
        className:
          "bg-[#F3E8FF] text-[#7C3AED] border border-[#7C3AED]/25",
        dot: "bg-[#7C3AED]",
      };
    }
    if (order.status === "dispatched") {
      return {
        label: ts("dispatched"),
        className:
          "bg-status-successBg text-status-success border border-status-success/25",
        dot: "bg-status-success",
      };
    }
    if (order.status === "rejected") {
      return {
        label: ts("rejected"),
        className:
          "bg-status-criticalBg text-status-critical border border-status-critical/25",
        dot: "bg-status-critical",
      };
    }
    if (order.status === "pending" || order.status === "assigned") {
      return {
        label: ts(order.status as Parameters<typeof ts>[0]),
        // New orders read as "fresh" with the blue nouveau accent + a live dot.
        className:
          "bg-[#1E3A5F]/10 text-[#1E3A5F] border border-[#1E3A5F]/25",
        dot: "bg-[#1E3A5F]",
      };
    }
    return null;
  })();

  const cardBorderClass = bucketBorderClass(selectedBucket, order.status);
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

      <div className="flex items-center gap-5">
        {/* Leading visual — product image, falling back to customer initials */}
        {order.product_image_url ? (
          <span className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg overflow-hidden bg-agent-surface-high border border-agent-outline-variant">
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
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-agent-surface-high border border-agent-outline-variant text-agent-primary text-[13px] font-bold"
          >
            {getCustomerInitials(order.customer_name)}
          </span>
        )}

        {/* Customer name + badges */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[14px] font-bold text-agent-on-surface truncate">
            <Highlighted value={order.customer_name} field="name" query={highlightQuery} />
          </span>
          {order.repeat_kind !== "none" && (
            <RepeatBuyerBadge
              source="order"
              sourceId={order.id}
              repeatKind={order.repeat_kind}
              priorOrderCount={order.prior_order_count}
              priorLeadCount={order.prior_lead_count}
              priorRejectedCount={order.prior_rejected_count}
              customerPhone={order.customer_phone}
            />
          )}
          {/* Duplicate marker — icon-only, shown on the anchor (newest) order.
              Opens a dialog that lists siblings and lets a permitted role delete
              a deletable sibling in place; onMutate revalidates the queue. */}
          {order.is_potential_duplicate && order.is_duplicate_anchor && (
            <DuplicateOrderBadge
              count={order.duplicate_count}
              siblings={order.duplicate_siblings}
              hasUploadedSibling={order.has_uploaded_sibling}
              anchorOrderId={order.id}
              canDelete={canDeleteDuplicateSiblingStatus(order.status)}
              onChange={onMutate}
            />
          )}
        </div>

        {/* Variant */}
        {order.variant_label && (
          <span
            className="hidden sm:inline text-[12.5px] font-semibold text-agent-on-surface truncate max-w-[140px] shrink-0"
            title={order.variant_label}
          >
            {order.variant_label}
          </span>
        )}

        {/* City */}
        {order.customer_city && (
          <span className="hidden md:inline-flex items-center gap-1 text-[12.5px] text-agent-on-surface-variant max-w-[120px] shrink-0">
            <MapPin size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            <span className="truncate">
              <Highlighted value={order.customer_city} field="city" query={highlightQuery} />
            </span>
          </span>
        )}

        {/* Created date + time on top, elapsed below (e.g. "21 mai 2026, 14:30" / "22j") */}
        <span
          className="hidden md:flex flex-col leading-tight gap-0.5 text-[12px] text-agent-on-surface-variant shrink-0"
          aria-label={t("createdAt", { date: formatLongDate(order.created_at, locale) })}
        >
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            <span className="tabular-nums">
              {formatLongDate(order.created_at, locale)}, {formatTime(order.created_at, locale)}
            </span>
          </span>
          <span className="ps-[18px] inline-flex items-center gap-1 text-[11px] opacity-70 tabular-nums">
            <Clock size={11} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            {elapsedLabel(order.assigned_at)}
          </span>
        </span>

        {/* Status sign. Always visible so the agent can read the order's
            state at a glance on any screen width. */}
        <div className="shrink-0 flex items-center">
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
                <StatusSign label={statusPill.label} dot={statusPill.dot} className={statusPill.className} />
              </RejectionReasonHover>
            ) : (
              <StatusSign label={statusPill.label} dot={statusPill.dot} className={statusPill.className} />
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

      {/* Call-ended action — shown while the order is still in the agent's hands */}
      {showEndCall && (
        <div className="flex justify-end mt-2">
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
