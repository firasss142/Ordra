"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Flag } from "lucide-react";
import type { InDeliveryInFlightOrder } from "@/app/api/in-delivery/summary/route";
import { useOrderTimeline } from "@/hooks/useOrderTimeline";
import { OrderTimeline } from "./OrderTimeline";

export function InFlightTable({
  orders,
  locale,
}: {
  orders: InDeliveryInFlightOrder[];
  locale: string;
}) {
  const t = useTranslations("inDelivery.inFlight");
  const tStatus = useTranslations("orders.statuses");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 24,
          fontSize: 13,
          color: "#6D7175",
          textAlign: "center",
        }}
      >
        {t("empty")}
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#F6F6F7" }}>
            <Th style={{ width: 32 }} />
            <Th>{t("col.customer")}</Th>
            <Th>{t("col.city")}</Th>
            <Th>{t("col.carrier")}</Th>
            <Th>{t("col.status")}</Th>
            <Th right>{t("col.updated")}</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const expanded = expandedId === order.id;
            return (
              <Row
                key={order.id}
                order={order}
                expanded={expanded}
                locale={locale}
                statusLabel={tStatus(order.status)}
                onToggle={() =>
                  setExpandedId((prev) => (prev === order.id ? null : order.id))
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  order,
  expanded,
  locale,
  statusLabel,
  onToggle,
}: {
  order: InDeliveryInFlightOrder;
  expanded: boolean;
  locale: string;
  statusLabel: string;
  onToggle: () => void;
}) {
  const t = useTranslations("inDelivery.inFlight");

  return (
    <>
      <tr>
        <Td style={{ width: 32 }}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? t("collapse") : t("expand")}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: 2,
              color: "#6D7175",
              display: "inline-flex",
            }}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </Td>
        <Td>
          <Link
            href={`/${locale}/in-delivery/${order.id}`}
            style={{ color: "#1A1A1A", textDecoration: "none", fontWeight: 500 }}
          >
            {order.customer_name || "—"}
          </Link>
          {order.external_id && (
            <div style={{ fontSize: 11, color: "#6D7175", marginTop: 2 }}>
              #{order.external_id}
            </div>
          )}
        </Td>
        <Td>{order.customer_city || "—"}</Td>
        <Td>{order.carrier_name || "—"}</Td>
        <Td>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusPill status={order.status} label={statusLabel} />
            {order.needs_carrier_followup && (
              <span
                title={t("escalatedTitle")}
                style={{ color: "#008060", display: "inline-flex" }}
              >
                <Flag size={12} strokeWidth={2} aria-hidden="true" />
              </span>
            )}
          </div>
        </Td>
        <Td right>
          <RelativeTime iso={order.updated_at} />
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={6}
            style={{
              padding: "16px 20px 20px",
              backgroundColor: "#FAFBFB",
              borderBlockEnd: "1px solid #E1E3E5",
            }}
          >
            <TimelineForOrder orderId={order.id} currentStatus={order.status} />
          </td>
        </tr>
      )}
    </>
  );
}

function TimelineForOrder({
  orderId,
  currentStatus,
}: {
  orderId: string;
  currentStatus: InDeliveryInFlightOrder["status"];
}) {
  const t = useTranslations("inDelivery.inFlight");
  const { timeline, isLoading, error } = useOrderTimeline(orderId);

  if (error) {
    return <div style={{ fontSize: 13, color: "#D72C0D" }}>{t("timelineError")}</div>;
  }
  if (!timeline || isLoading) {
    return <div style={{ fontSize: 13, color: "#6D7175" }}>{t("timelineLoading")}</div>;
  }
  return <OrderTimeline stages={timeline.stages} currentStatus={currentStatus} />;
}

function RelativeTime({ iso }: { iso: string }) {
  const t = useTranslations("inDelivery.inFlight");
  const diffHours = Math.max(0, (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000));
  let label: string;
  if (diffHours < 1) label = t("justNow");
  else if (diffHours < 24) label = t("hoursAgo", { h: Math.round(diffHours) });
  else label = t("daysAgo", { d: Math.round((diffHours / 24) * 10) / 10 });

  return (
    <span
      style={{ fontVariantNumeric: "tabular-nums", color: "#6D7175", fontSize: 13 }}
    >
      {label}
    </span>
  );
}

function Th({ children, right = false, style }: { children?: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: "12px 16px",
        fontSize: 13,
        fontWeight: 500,
        color: "#6D7175",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        textAlign: right ? "end" : "start",
        borderBlockEnd: "1px solid #D1D5DB",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right = false, style }: { children?: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: "12px 16px",
        fontSize: 14,
        color: "#1A1A1A",
        borderBlockEnd: "1px solid #E1E3E5",
        textAlign: right ? "end" : "start",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === "to_be_returned" ? "critical" : status === "dispatched" ? "action" : "neutral";
  const bg =
    tone === "critical" ? "#FFF4F4" : tone === "action" ? "#EAF2FB" : "#F6F6F7";
  const fg =
    tone === "critical" ? "#D72C0D" : tone === "action" ? "#2C6ECB" : "#6D7175";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 500,
        backgroundColor: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  );
}
