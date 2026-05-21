"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Phone, Clock, Check, CalendarDays } from "lucide-react";
import { extractAttemptNumber } from "@/lib/attempt-logic";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { AttemptEtiquette } from "./AttemptEtiquette";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { DuplicateOrderBadge } from "@/components/shared/DuplicateOrderBadge";
import { RejectionReasonHover } from "./RejectionReasonHover";
import { AddressChangeNote } from "./AddressChangeNote";
import type { QueueOrder } from "@/types/queue";
import type { BucketKey } from "./QueueHeader";

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

  const attemptNumber = extractAttemptNumber(order.status);
  const isAttemptStatus = attemptNumber > 0;
  const currentAttemptCount =
    isAttemptStatus ? Math.max(order.attempt_count ?? 0, attemptNumber) : 0;
  const isMaxAttempt = currentAttemptCount >= maxAttempts;

  const showRow3 =
    isAttemptStatus ||
    order.status === "callback_scheduled" ||
    order.status === "dispatch_scheduled" ||
    order.customer_note !== null;

  const truncatedNote =
    order.customer_note && order.customer_note.length > 60
      ? order.customer_note.slice(0, 60) + "…"
      : order.customer_note;

  function elapsedLabel(assignedAt: string): string {
    const diffMs = Date.now() - new Date(assignedAt).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const formatCount = (value: number) => new Intl.NumberFormat(locale).format(value);
    if (diffMins < 60) {
      return t("elapsed", {
        time: t("elapsedUnits.minutes", { count: formatCount(diffMins) }),
      });
    }
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return t("elapsed", {
        time: t("elapsedUnits.hours", { count: formatCount(diffHours) }),
      });
    }
    return t("elapsed", {
      time: t("elapsedUnits.days", { count: formatCount(Math.floor(diffHours / 24)) }),
    });
  }

  function getCustomerInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  // Status pill style: attempts/callbacks are handled by AttemptEtiquette.
  const statusPill = (() => {
    if (order.status === "confirmed") {
      return {
        label: ts("confirmed"),
        className:
          "bg-agent-primary-container/15 text-agent-on-primary-container border border-agent-primary/20",
      };
    }
    if (order.status === "uploaded") {
      return {
        label: ts("uploaded"),
        className:
          "bg-[#F3E8FF] text-[#7C3AED] border border-[#7C3AED]/25",
      };
    }
    if (order.status === "dispatched") {
      return {
        label: ts("dispatched"),
        className:
          "bg-status-successBg text-status-success border border-status-success/25",
      };
    }
    if (order.status === "rejected") {
      return {
        label: ts("rejected"),
        className:
          "bg-status-criticalBg text-status-critical border border-status-critical/25",
      };
    }
    if (order.status === "pending" || order.status === "assigned") {
      return {
        label: ts(order.status as Parameters<typeof ts>[0]),
        className:
          "bg-agent-surface-high text-agent-on-surface-variant border border-agent-outline-variant",
      };
    }
    return null;
  })();

  const cardBorderClass = bucketBorderClass(selectedBucket, order.status);

  return (
    <div
      data-order-id={order.id}
      data-focused={focused || undefined}
      onClick={() => onOpenDetail(order.id)}
      data-selected={isSelected || undefined}
      className={[
        "group relative cursor-pointer agent-card-hover",
        "rounded-xl p-4",
        "bg-agent-surface",
        cardBorderClass,
        isSelected ? "ring-2 ring-black/20" : "",
      ].join(" ")}
    >
      {/* Bulk-select checkbox — top-leading corner, fades in on hover */}
      {onToggleSelect && (
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

      <div className="flex items-center gap-4">
        {/* Customer avatar */}
        <div
          aria-hidden="true"
          className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-agent-surface-high border border-agent-outline-variant text-agent-primary text-[15px] font-bold"
        >
          {getCustomerInitials(order.customer_name)}
        </div>

        {/* Customer + meta — name on top, phone · city below */}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-bold text-agent-on-surface truncate">
              {order.customer_name}
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
            {order.is_potential_duplicate && (
              <DuplicateOrderBadge
                count={order.duplicate_count}
                siblings={order.duplicate_siblings}
                hasUploadedSibling={order.has_uploaded_sibling}
              />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[12.5px] text-agent-on-surface-variant">
            <a
              href={`tel:${order.customer_phone}`}
              onClick={(e) => e.stopPropagation()}
              aria-label={t("phoneAria", { phone: order.customer_phone })}
              className="inline-flex items-center gap-1 tabular-nums hover:text-agent-on-surface hover:underline"
            >
              <Phone size={11} strokeWidth={2} aria-hidden="true" />
              <span>{order.customer_phone}</span>
            </a>
            {order.customer_city && (
              <>
                <span aria-hidden="true" className="opacity-60">·</span>
                <span className="truncate">{order.customer_city}</span>
              </>
            )}
            <span aria-hidden="true" className="opacity-60">·</span>
            <span
              className="inline-flex items-center gap-1 tabular-nums shrink-0"
              aria-label={t("createdAt", { date: formatDateTime(order.created_at, locale) })}
            >
              <CalendarDays size={11} strokeWidth={2} aria-hidden="true" />
              {formatDateTime(order.created_at, locale)}
            </span>
          </div>
        </div>

        {/* Product column — divider on lead edge */}
        <div className="hidden md:flex flex-col items-center px-5 border-x border-agent-outline-variant/40 shrink-0 max-w-[180px]">
          <span className="text-[10px] font-bold text-agent-on-surface-variant uppercase tracking-[0.06em]">
            {t("productsLabel")}
          </span>
          <span
            className="mt-0.5 text-[13px] font-semibold text-agent-on-surface truncate max-w-[160px]"
            title={`${order.product_name}${order.variant_label ? ` · ${order.variant_label}` : ""}`}
          >
            {order.product_name}
          </span>
          {order.variant_label && (
            <span className="text-[11px] text-agent-on-surface-variant truncate max-w-[160px]">
              {order.variant_label}
            </span>
          )}
        </div>

        {/* Price + elapsed */}
        <div className="flex flex-col items-end px-2 shrink-0">
          <span className="text-[18px] font-bold text-agent-primary tabular-nums leading-tight">
            {order.total_price}
            <span className="ms-1 text-[11px] font-semibold text-agent-on-surface-variant">
              {order.currency}
            </span>
          </span>
          <span className="mt-0.5 text-[11.5px] text-agent-on-surface-variant inline-flex items-center gap-1">
            <Clock size={11} strokeWidth={2} aria-hidden="true" />
            {elapsedLabel(order.assigned_at)}
          </span>
        </div>

        {/* Status pill — far trailing edge */}
        <div className="shrink-0 ps-2 hidden lg:flex items-center">
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
                <span
                  className={[
                    "inline-flex items-center px-3.5 py-1 rounded-pill text-[11px] font-bold tracking-[0.04em]",
                    statusPill.className,
                  ].join(" ")}
                >
                  {statusPill.label}
                </span>
              </RejectionReasonHover>
            ) : (
              <span
                className={[
                  "inline-flex items-center px-3.5 py-1 rounded-pill text-[11px] font-bold tracking-[0.04em]",
                  statusPill.className,
                ].join(" ")}
              >
                {statusPill.label}
              </span>
            )
          ) : null}
        </div>
      </div>

      {/* Optional supporting row — address change, customer note, attempts overdue */}
      {(order.last_known_address ||
        truncatedNote ||
        (isAttemptStatus && isMaxAttempt) ||
        (order.status === "callback_scheduled" && callbackOverdue) ||
        (order.status === "dispatch_scheduled" && dispatchOverdue)) && (
        <div className="mt-3 ps-16 flex flex-col gap-1.5">
          {order.last_known_address && (
            <AddressChangeNote
              currentAddress={order.customer_address}
              lastKnownAddress={order.last_known_address}
            />
          )}
          {isAttemptStatus && isMaxAttempt && (
            <span className="text-[12px] font-bold text-agent-error">
              {t("attempts", { count: `${currentAttemptCount}/${maxAttempts}` })}
            </span>
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

      {/* Call-ended action — shown for any non-terminal status; trailing edge */}
      {showRow3 && (
        <div className="flex justify-end mt-3">
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
