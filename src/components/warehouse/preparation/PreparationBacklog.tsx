"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { WarehouseInboxBanner } from "@/components/warehouse/WarehouseInboxBanner";

const D = {
  pageBg: "#F6F6F7",
  cardBg: "#FFFFFF",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  danger: "#D72C0D",
  warning: "#B98900",
} as const;

interface ApiResponse {
  orders: WarehouseOrderRow[];
}

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
  trayIds: Set<string>;
  onAddToTray: (row: WarehouseOrderRow) => void;
  labels: {
    title: string;
    empty: string;
    colCity: string;
    colCustomer: string;
    colProduct: string;
    colId: string;
    addToTray: string;
    inTray: string;
    newReveal: string;
    dismiss: string;
    lowStock: string;
    criticalStock: string;
  };
}

function StockBadge({ stock, labels }: { stock: number; labels: { lowStock: string; criticalStock: string } }) {
  if (stock === 0) {
    return (
      <span style={{ fontSize: 10, fontWeight: 600, color: D.danger, backgroundColor: "#FFF4F2", borderRadius: 4, padding: "1px 6px" }}>
        {labels.criticalStock}
      </span>
    );
  }
  if (stock <= 5) {
    return (
      <span style={{ fontSize: 10, fontWeight: 600, color: D.warning, backgroundColor: "#FFF8E5", borderRadius: 4, padding: "1px 6px" }}>
        {labels.lowStock}
      </span>
    );
  }
  return null;
}

interface RowItemProps {
  order: WarehouseOrderRow;
  inTray: boolean;
  onAdd: (row: WarehouseOrderRow) => void;
  labels: Props["labels"];
}

const RowItem = memo(function RowItem({ order, inTray, onAdd, labels }: RowItemProps) {
  return (
    <tr>
      <td style={{ padding: "10px 16px", fontSize: 13, color: D.textPrimary }}>{order.customer_city ?? "—"}</td>
      <td style={{ padding: "10px 16px", fontSize: 13, color: D.textPrimary, fontWeight: 500 }}>{order.customer_name}</td>
      <td style={{ padding: "10px 16px", fontSize: 12, color: D.textSecondary }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {order.product_name}
          {order.current_stock != null && (
            <StockBadge stock={order.current_stock} labels={labels} />
          )}
        </div>
      </td>
      <td style={{ padding: "10px 16px", fontSize: 11, color: D.textSecondary, fontFamily: "monospace" }}>
        {order.id.slice(0, 8).toUpperCase()}
      </td>
      <td style={{ padding: "10px 16px" }}>
        {inTray ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: D.accent }}>
            {labels.inTray}
          </span>
        ) : (
          <button
            onClick={() => onAdd(order)}
            title={labels.addToTray}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: D.textPrimary,
              backgroundColor: "#F6F6F7",
              border: `1px solid ${D.border}`,
              borderRadius: 5,
              padding: "4px 8px",
              cursor: "pointer",
              transition: "background-color 120ms",
            }}
          >
            <Plus size={12} />
            {labels.addToTray}
          </button>
        )}
      </td>
    </tr>
  );
});

export function PreparationBacklog({
  marketId,
  fallbackRows,
  trayIds,
  onAddToTray,
  labels,
}: Props) {
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [arrivalCount, setArrivalCount] = useState(0);

  const { data, mutate } = useSWR<ApiResponse>(
    "/api/warehouse/to-label",
    jsonFetcher,
    {
      fallbackData: { orders: fallbackRows },
      refreshInterval: 120_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
    },
  );

  useWarehouseRealtime({
    marketId,
    page: "to-label",
    onRefresh: mutate,
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  const allOrders = useMemo(() => data?.orders ?? [], [data]);

  useEffect(() => { setPage(0); }, [allOrders]);

  const pageStart = page * pageSize;
  const pageOrders = useMemo(
    () => allOrders.slice(pageStart, pageStart + pageSize),
    [allOrders, pageStart, pageSize],
  );

  const handleAdd = useCallback(
    (row: WarehouseOrderRow) => onAddToTray(row),
    [onAddToTray],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => { setArrivalCount(0); mutate(); }}
        onDismiss={() => setArrivalCount(0)}
        labels={{ reveal: labels.newReveal, dismiss: labels.dismiss }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 4px",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, color: D.textPrimary, margin: 0 }}>
          {labels.title} ({allOrders.length})
        </h2>
      </div>

      <div
        style={{
          backgroundColor: D.cardBg,
          border: `1px solid ${D.border}`,
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {allOrders.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", fontSize: 13, color: D.textSecondary }}>
            {labels.empty}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#FAFAFA", borderBottom: `1px solid ${D.border}` }}>
                {[labels.colCity, labels.colCustomer, labels.colProduct, labels.colId, ""].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "8px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      fontWeight: 600,
                      color: D.textSecondary,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageOrders.map((order) => (
                <RowItem
                  key={order.id}
                  order={order}
                  inTray={trayIds.has(order.id)}
                  onAdd={handleAdd}
                  labels={labels}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {allOrders.length > pageSize && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              border: `1px solid ${D.border}`,
              borderRadius: 5,
              backgroundColor: D.cardBg,
              color: D.textPrimary,
              cursor: page === 0 ? "default" : "pointer",
              opacity: page === 0 ? 0.4 : 1,
            }}
          >
            ‹ Préc.
          </button>
          <span style={{ fontSize: 12, color: D.textSecondary, lineHeight: "32px" }}>
            {page + 1} / {Math.ceil(allOrders.length / pageSize)}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(Math.ceil(allOrders.length / pageSize) - 1, p + 1))}
            disabled={pageStart + pageSize >= allOrders.length}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              border: `1px solid ${D.border}`,
              borderRadius: 5,
              backgroundColor: D.cardBg,
              color: D.textPrimary,
              cursor: pageStart + pageSize >= allOrders.length ? "default" : "pointer",
              opacity: pageStart + pageSize >= allOrders.length ? 0.4 : 1,
            }}
          >
            Suiv. ›
          </button>
        </div>
      )}
    </div>
  );
}
