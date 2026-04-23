"use client";

import { useTranslations } from "next-intl";
import { OrderCard } from "./OrderCard";
import type { QueueOrder } from "@/types/queue";

interface QueueStats {
  assigned_count: number;
  actioned_count: number;
  confirmation_rate: number;
}

interface QueueListProps {
  orders: QueueOrder[];
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  onRefresh?: () => void;
  stats?: QueueStats;
  focusedOrderId?: string | null;
  selectedOrderIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function QueueList({
  orders,
  onOpenDetail,
  onCallTerminated,
  onRefresh,
  stats,
  focusedOrderId,
  selectedOrderIds,
  onToggleSelect,
}: QueueListProps) {
  const t = useTranslations("queue");

  if (orders.length === 0) {
    return (
      <div
        role="status"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 24px",
          gap: 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            backgroundColor: "#F3F4F6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            color: "#9CA3AF",
          }}
        >
          ✓
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
          {t("emptyStateTitle")}
        </div>
        <div style={{ fontSize: 13, color: "#6B7280", textAlign: "center", maxWidth: 360 }}>
          {t("emptyStateSubtitle")}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            style={{
              marginTop: 8,
              fontSize: 13,
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "0.25rem",
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            {t("refreshQueue")}
          </button>
        )}
        {stats && (
          <div
            style={{
              marginTop: 24,
              padding: "16px 20px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              display: "flex",
              gap: 24,
              fontSize: 13,
              color: "#6B7280",
            }}
          >
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("todayStats")}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>{stats.assigned_count}</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{t("stats.assigned")}</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>{stats.actioned_count}</div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{t("stats.actioned")}</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>
                {stats.confirmation_rate.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: "#6B7280" }}>{t("stats.confirmationRate")}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          onOpenDetail={onOpenDetail}
          onCallTerminated={onCallTerminated}
          focused={focusedOrderId === order.id}
          isSelected={selectedOrderIds?.has(order.id) ?? false}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
