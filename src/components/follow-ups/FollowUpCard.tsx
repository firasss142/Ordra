"use client";

import React, { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { FollowUpStatusBadge } from "./FollowUpStatusBadge";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

interface Props {
  followUp: OrderFollowUpWithOrder;
  marketCode: "TN" | "LY";
  locale: string;
  density?: "comfortable" | "compact";
}

function FollowUpCardImpl({
  followUp,
  marketCode,
  locale,
  density = "comfortable",
}: Props) {
  const t = useTranslations("crm.followUps");
  const { order } = followUp;
  const compact = density === "compact";
  const padding = compact ? 10 : 12;

  return (
    <Link
      href={`/${locale}/follow-ups/${followUp.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "white",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding,
      }}
    >
      {/* Line 1: name + price */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <strong
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1A1A1A",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {order.customer_name}
        </strong>
        <span
          style={{
            fontSize: 13,
            color: "#1A1A1A",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {formatCurrency(order.total_price, marketCode)}
        </span>
      </div>

      {/* Line 2: phone · city */}
      <div style={{ fontSize: 13, color: "#6D7175" }}>
        {order.customer_phone}
        {order.customer_city ? ` · ${order.customer_city}` : ""}
      </div>

      {/* Line 3: delivery man (optional) */}
      {followUp.delivery_man_phone && (
        <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
          {t("deliveryMan")}: {followUp.delivery_man_phone}
        </div>
      )}

      {/* Line 4: order status + follow-up status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginTop: compact ? 6 : 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#6D7175",
            background: "#F6F6F7",
            border: "1px solid #E1E3E5",
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          {order.status}
        </span>
        <FollowUpStatusBadge status={followUp.status} />
      </div>

      {/* Line 5: description (optional, clamped) */}
      {!compact && followUp.description && (
        <div
          style={{
            fontSize: 12,
            color: "#4B5563",
            marginTop: 8,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {followUp.description}
        </div>
      )}

      {/* Line 6: campaign chip (only when this follow-up belongs to a named campaign) */}
      {followUp.campaign && (
        <div style={{ marginTop: compact ? 4 : 6 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 11,
              fontWeight: 500,
              color: "#6D7175",
              background: "#F6F6F7",
              border: "1px solid #E1E3E5",
              borderRadius: 4,
              padding: "1px 6px",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {followUp.campaign.name}
          </span>
        </div>
      )}
    </Link>
  );
}

export const FollowUpCard = memo(FollowUpCardImpl, (prev, next) => {
  return (
    prev.followUp.id === next.followUp.id &&
    prev.followUp.status === next.followUp.status &&
    prev.followUp.updated_at === next.followUp.updated_at &&
    prev.followUp.delivery_man_phone === next.followUp.delivery_man_phone &&
    prev.followUp.description === next.followUp.description &&
    prev.density === next.density &&
    prev.locale === next.locale &&
    prev.marketCode === next.marketCode
  );
});

/**
 * Functional accent for follow-up cards. Escalated = critical; all others neutral.
 */
export function followUpCardAccent(
  followUp: OrderFollowUpWithOrder
): "neutral" | "warning" | "critical" {
  if (followUp.status === "escalated") return "critical";
  return "neutral";
}
