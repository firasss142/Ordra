"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Phone, MapPin, Package, Check } from "lucide-react";
import { extractAttemptNumber } from "@/lib/attempt-logic";
import { formatDateTime, formatExactTime } from "@/lib/format";
import { getProductAvatarColor, getProductInitial } from "@/lib/product-avatar";
import { Button } from "@/components/ui/Button";
import { AttemptEtiquette } from "./AttemptEtiquette";
import { StatusGlyph } from "@/components/shared/StatusGlyph";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import { AddressChangeNote } from "./AddressChangeNote";
import type { QueueOrder } from "@/types/queue";

interface OrderCardProps {
  order: QueueOrder;
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  maxAttempts?: number;
  focused?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
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
  const callbackFuture = now !== null && callbackDate !== null && callbackDate > now;

  const dispatchDate = order.scheduled_dispatch_at
    ? new Date(order.scheduled_dispatch_at)
    : null;
  const dispatchOverdue =
    now !== null && dispatchDate !== null && dispatchDate <= now;
  const dispatchFuture =
    now !== null && dispatchDate !== null && dispatchDate > now;

  const attemptNumber = extractAttemptNumber(order.status);
  const isAttemptStatus = attemptNumber > 0;
  const isMaxAttempt = attemptNumber >= maxAttempts;

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
    if (diffMins < 60) return t("elapsed", { time: `${diffMins}min` });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t("elapsed", { time: `${diffHours}h` });
    return t("elapsed", { time: `${Math.floor(diffHours / 24)}j` });
  }

  return (
    <div
      data-order-id={order.id}
      data-focused={focused || undefined}
      onClick={() => onOpenDetail(order.id)}
      data-selected={isSelected || undefined}
      className={[
        "group relative cursor-pointer",
        "border-b border-line-subtle",
        "ps-6 pe-6 py-4",
        "transition-[background-color,box-shadow] duration-fast",
        isSelected
          ? "bg-[#F0F7F4] hover:bg-[#E8F3EE]"
          : focused
            ? "bg-surface-selected"
            : "bg-surface-card hover:bg-surface-hover hover:shadow-hover-row",
      ].join(" ")}
    >
      {/* Inline-start accent bar — accent green when focused or selected */}
      <span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute inset-y-0 start-0 w-[3px]",
          "transition-colors duration-fast",
          isSelected
            ? "bg-accent"
            : focused
              ? "bg-accent"
              : "bg-transparent group-hover:bg-line-strong",
        ].join(" ")}
      />

      {/* Row 1 — identity + status + time */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2.5 min-w-0">
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
                "shrink-0 inline-flex items-center justify-center",
                "h-[18px] w-[18px] rounded-[4px] border",
                "transition-all duration-fast",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1",
                isSelected
                  ? "bg-accent border-accent opacity-100"
                  : "bg-surface-card border-line-strong opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:border-ink-primary [[data-has-selection]_&]:opacity-100",
              ].join(" ")}
            >
              {isSelected && (
                <Check size={12} strokeWidth={3} className="text-white" aria-hidden="true" />
              )}
            </button>
          )}
          <div
            aria-hidden="true"
            className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full ring-1 ring-line-subtle text-[11px] font-bold text-ink-primary"
            style={{ backgroundColor: getProductAvatarColor(order.product_name) }}
          >
            {getProductInitial(order.product_name)}
          </div>
          <span className="text-[15px] font-semibold text-ink-primary truncate">
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
          {isAttemptOrCallback(order.status) ? (
            <AttemptEtiquette
              status={order.status}
              attemptsCount={order.attempt_count ?? 0}
              callbackAt={order.callback_time}
              scheduledDispatchAt={order.scheduled_dispatch_at}
              scheduledDispatchAuto={order.scheduled_dispatch_auto}
              now={now ?? undefined}
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">
              <StatusGlyph
                shape={order.status === "confirmed" ? "check" : "ring"}
                tone="muted"
              />
              <span>{ts(order.status as Parameters<typeof ts>[0])}</span>
            </span>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0 ps-3">
          <span className="text-[13px] text-ink-secondary">
            {elapsedLabel(order.assigned_at)}
          </span>
          <span className="text-[11px] text-ink-muted tabular-nums">
            {now ? formatExactTime(order.assigned_at, locale) : ""}
          </span>
        </div>
      </div>

      {/* Row 2 — scan grid: phone | city | product | price */}
      <div
        className="grid items-center gap-x-3.5"
        style={{
          gridTemplateColumns:
            "minmax(140px, auto) minmax(0, auto) minmax(0, 1fr) auto",
          marginBottom: 0,
        }}
      >
        <a
          href={`tel:${order.customer_phone}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("phoneAria", { phone: order.customer_phone })}
          className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink-primary tabular-nums tracking-[0.01em] whitespace-nowrap no-underline hover:[&_[data-phone-text]]:underline"
        >
          <Phone size={14} strokeWidth={2} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <span data-phone-text>{order.customer_phone}</span>
        </a>

        <span
          className="inline-flex items-center gap-1 max-w-[180px] overflow-hidden whitespace-nowrap text-ellipsis rounded-pill bg-[#F3F4F6] px-2 py-[3px] text-[12px] font-medium text-[#4B5563]"
          title={order.customer_city}
        >
          <MapPin size={11} strokeWidth={2} className="shrink-0 opacity-70" aria-hidden="true" />
          {order.customer_city}
        </span>

        <span
          className="inline-flex items-center gap-1.5 min-w-0 justify-self-end text-[13.5px] text-ink-primary"
          title={`${order.product_name}${order.variant_label ? ` · ${order.variant_label}` : ""}`}
        >
          <Package size={13} strokeWidth={2} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="truncate font-medium">
            {order.product_name}
            {order.variant_label ? (
              <span className="text-ink-muted font-normal"> · {order.variant_label}</span>
            ) : null}
          </span>
        </span>

        <span className="text-[15px] font-bold text-ink-primary tabular-nums whitespace-nowrap tracking-[-0.01em]">
          {order.total_price}
          <span className="ms-1 text-[12px] font-medium text-ink-secondary">
            {order.currency}
          </span>
        </span>
      </div>

      {order.last_known_address && (
        <div className={showRow3 ? "mt-1 mb-2" : "mt-1"}>
          <AddressChangeNote
            currentAddress={order.customer_address}
            lastKnownAddress={order.last_known_address}
          />
        </div>
      )}

      {/* Row 3 — conditional supporting metadata + Call ended button */}
      {showRow3 && (
        <div className="flex justify-between items-center mb-2">
          <div className="flex gap-3 items-start">
            {isAttemptStatus && (
              <span
                className={[
                  "text-[13px]",
                  isMaxAttempt ? "font-bold text-status-critical" : "text-[#F97316]",
                ].join(" ")}
              >
                {t("attempts", { count: `${attemptNumber}/${maxAttempts}` })}
              </span>
            )}
            {order.status === "callback_scheduled" && callbackFuture && callbackDate && (
              <span className="text-[13px] text-ink-secondary">
                {t("callbackAt", { time: formatDateTime(order.callback_time!, locale) })}
              </span>
            )}
            {order.status === "callback_scheduled" && callbackOverdue && callbackDate && (
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold text-status-critical">
                  {t("callbackAt", { time: "⚠" })}
                </span>
                <span className="text-[13px] text-status-critical">
                  {formatDateTime(order.callback_time!, locale)}
                </span>
              </span>
            )}
            {order.status === "callback_scheduled" && !callbackDate && (
              <span className="text-[13px] text-ink-secondary">
                {ts("callback_scheduled")}
              </span>
            )}
            {order.status === "dispatch_scheduled" && dispatchFuture && dispatchDate && (
              <span className="text-[13px] text-ink-secondary">
                {order.scheduled_dispatch_auto
                  ? t("dispatchAtAuto", {
                      time: formatDateTime(order.scheduled_dispatch_at!, locale),
                    })
                  : t("dispatchAt", {
                      time: formatDateTime(order.scheduled_dispatch_at!, locale),
                    })}
              </span>
            )}
            {order.status === "dispatch_scheduled" && dispatchOverdue && dispatchDate && (
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-bold text-status-critical">
                  {t("dispatchOverdue")}
                </span>
                <span className="text-[13px] text-status-critical">
                  {formatDateTime(order.scheduled_dispatch_at!, locale)}
                </span>
              </span>
            )}
            {order.status === "dispatch_scheduled" && !dispatchDate && (
              <span className="text-[13px] text-ink-secondary">
                {ts("dispatch_scheduled")}
              </span>
            )}
            {truncatedNote && (
              <span className="text-[12px] text-ink-muted">{truncatedNote}</span>
            )}
          </div>
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

      {!showRow3 && (
        <div
          className={[
            "flex justify-end mt-1.5 transition-opacity duration-fast",
            focused
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          ].join(" ")}
        >
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
