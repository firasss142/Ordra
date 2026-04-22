"use client";

import { memo, useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { extractAttemptNumber } from "@/lib/attempt-logic";
import { formatDateTime } from "@/lib/format";
import { AttemptEtiquette } from "./AttemptEtiquette";
import { StatusGlyph } from "@/components/shared/StatusGlyph";
import type { QueueOrder } from "@/types/queue";

interface OrderCardProps {
  order: QueueOrder;
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  maxAttempts?: number;
  focused?: boolean;
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

export const OrderCard = memo(function OrderCard({ order, onOpenDetail, onCallTerminated, maxAttempts = 3, focused = false }: OrderCardProps) {
  const t = useTranslations("queue");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();

  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

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
      style={{
        backgroundColor: focused ? "#F6F6F7" : "#FFFFFF",
        borderBottom: "1px solid #E1E3E5",
        padding: "16px 24px",
        cursor: "pointer",
        outline: focused ? "2px solid #1A1A1A" : "none",
        outlineOffset: focused ? "-2px" : undefined,
      }}
      onClick={() => onOpenDetail(order.id)}
    >
      {/* Row 1 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
            {order.customer_name}
          </span>
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
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text-secondary)",
              }}
            >
              <StatusGlyph
                shape={order.status === "confirmed" ? "check" : "ring"}
                tone="muted"
              />
              <span>{ts(order.status as Parameters<typeof ts>[0])}</span>
            </span>
          )}
        </div>
        <span style={{ fontSize: 13, color: "#6B7280" }}>
          {elapsedLabel(order.assigned_at)}
        </span>
      </div>

      {/* Row 2 — scan grid: [phone] [city-pill] [product] [price] */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(140px, auto) minmax(0, auto) minmax(0, 1fr) auto",
          alignItems: "center",
          columnGap: 14,
          marginBottom: showRow3 ? 8 : 0,
        }}
      >
        {/* Phone — hero scan element */}
        <a
          href={`tel:${order.customer_phone}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 15,
            fontWeight: 600,
            color: "#1A1A1A",
            textDecoration: "none",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget.querySelector("[data-phone-text]") as HTMLElement | null;
            if (el) el.style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget.querySelector("[data-phone-text]") as HTMLElement | null;
            if (el) el.style.textDecoration = "none";
          }}
          aria-label={t("phoneAria", { phone: order.customer_phone })}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6B7280"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span data-phone-text>{order.customer_phone}</span>
        </a>

        {/* City — subtle pill for instant location scan */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontWeight: 500,
            color: "#4B5563",
            backgroundColor: "#F3F4F6",
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 180,
          }}
          title={order.customer_city}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0, opacity: 0.7 }}
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          {order.customer_city}
        </span>

        {/* Product — scan zone with subtle icon */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13.5,
            color: "#1A1A1A",
            minWidth: 0,
            justifySelf: "end",
          }}
          title={`${order.product_name}${order.variant_label ? ` · ${order.variant_label}` : ""}`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span
            style={{
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {order.product_name}
            {order.variant_label ? (
              <span style={{ color: "#9CA3AF", fontWeight: 400 }}> · {order.variant_label}</span>
            ) : null}
          </span>
        </span>

        {/* Price — bold terminal anchor */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#1A1A1A",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            letterSpacing: "-0.01em",
          }}
        >
          {order.total_price}
          <span style={{ fontSize: 12, fontWeight: 500, color: "#6B7280", marginInlineStart: 3 }}>
            {order.currency}
          </span>
        </span>
      </div>

      {/* Row 3 — conditional */}
      {showRow3 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {isAttemptStatus && (
              <span
                style={{
                  fontSize: 13,
                  color: isMaxAttempt ? "#DC2626" : "#F97316",
                  fontWeight: isMaxAttempt ? 700 : 400,
                }}
              >
                {t("attempts", { count: `${attemptNumber}/${maxAttempts}` })}
              </span>
            )}
            {order.status === "callback_scheduled" && callbackFuture && callbackDate && (
              <span style={{ fontSize: 13, color: "#6B7280" }}>
                {t("callbackAt", { time: formatDateTime(order.callback_time!, locale) })}
              </span>
            )}
            {order.status === "callback_scheduled" && callbackOverdue && callbackDate && (
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, color: "#DC2626", fontWeight: 700 }}>
                  {t("callbackAt", { time: "⚠" })}
                </span>
                <span style={{ fontSize: 13, color: "#DC2626" }}>
                  {formatDateTime(order.callback_time!, locale)}
                </span>
              </span>
            )}
            {order.status === "callback_scheduled" && !callbackDate && (
              <span style={{ fontSize: 13, color: "#6B7280" }}>{ts("callback_scheduled")}</span>
            )}
            {order.status === "dispatch_scheduled" && dispatchFuture && dispatchDate && (
              <span style={{ fontSize: 13, color: "#6B7280" }}>
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
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 13, color: "#DC2626", fontWeight: 700 }}>
                  {t("dispatchOverdue")}
                </span>
                <span style={{ fontSize: 13, color: "#DC2626" }}>
                  {formatDateTime(order.scheduled_dispatch_at!, locale)}
                </span>
              </span>
            )}
            {order.status === "dispatch_scheduled" && !dispatchDate && (
              <span style={{ fontSize: 13, color: "#6B7280" }}>
                {ts("dispatch_scheduled")}
              </span>
            )}
            {truncatedNote && (
              <span style={{ fontSize: 12, color: "#9CA3AF" }}>{truncatedNote}</span>
            )}
          </div>
          {/* "Call ended" button — bottom-end (RTL-safe) */}
          <button
            style={{
              fontSize: 13,
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "0.25rem",
              padding: "6px 12px",
              cursor: "pointer",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCallTerminated(order.id);
            }}
          >
            {t("callEnded")}
          </button>
        </div>
      )}

      {/* "Call ended" when no row 3 content */}
      {!showRow3 && (
        <div style={{ display: "flex", justifyContent: "end", marginTop: 8 }}>
          <button
            style={{
              fontSize: 13,
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "0.25rem",
              padding: "6px 12px",
              cursor: "pointer",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCallTerminated(order.id);
            }}
          >
            {t("callEnded")}
          </button>
        </div>
      )}
    </div>
  );
});
