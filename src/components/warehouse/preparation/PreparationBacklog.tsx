"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { WarehouseInboxBanner } from "@/components/warehouse/WarehouseInboxBanner";
import { Badge } from "@/components/ui/Badge";

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

function StockBadge({
  stock,
  labels,
}: {
  stock: number;
  labels: { lowStock: string; criticalStock: string };
}) {
  if (stock === 0) {
    return <Badge tone="critical">{labels.criticalStock}</Badge>;
  }
  if (stock <= 5) {
    return <Badge tone="warning">{`${labels.lowStock} · ${stock}`}</Badge>;
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
    <tr className="border-b border-line-subtle hover:bg-surface-hover transition-colors duration-fast">
      <td className="px-4 py-2.5 text-[13px] text-ink-primary">{order.customer_city ?? "—"}</td>
      <td className="px-4 py-2.5 text-[13px] text-ink-primary font-medium">{order.customer_name}</td>
      <td className="px-4 py-2.5 text-[12px] text-ink-secondary">
        <div className="flex items-center gap-1.5">
          {order.product_name}
          {order.current_stock != null && (
            <StockBadge stock={order.current_stock} labels={labels} />
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-[11px] text-ink-secondary font-mono tabular-nums">
        {order.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-2.5">
        {inTray ? (
          <span className="text-[11px] font-semibold text-status-success">
            {labels.inTray}
          </span>
        ) : (
          <button
            onClick={() => onAdd(order)}
            title={labels.addToTray}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-primary bg-surface-page border border-line-subtle rounded-md px-2 py-1 hover:bg-surface-hover transition-colors duration-fast"
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
    <div className="flex flex-col gap-3">
      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => { setArrivalCount(0); mutate(); }}
        onDismiss={() => setArrivalCount(0)}
        labels={{ reveal: labels.newReveal, dismiss: labels.dismiss }}
      />

      <div className="flex items-center justify-between px-1">
        <h2 className="text-[14px] font-semibold text-ink-primary m-0 tabular-nums">
          {labels.title} ({allOrders.length})
        </h2>
      </div>

      <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
        {allOrders.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">
            {labels.empty}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-hover border-b border-line-subtle">
                {[labels.colCity, labels.colCustomer, labels.colProduct, labels.colId, ""].map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2 text-start text-[11px] font-semibold text-ink-secondary uppercase tracking-[0.04em]"
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
        <div className="flex justify-center gap-2 items-center">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3.5 py-1.5 text-[12px] border border-line-subtle rounded-md bg-surface-card text-ink-primary disabled:opacity-40 disabled:cursor-default hover:bg-surface-hover transition-colors duration-fast"
          >
            ‹ Préc.
          </button>
          <span className="text-[12px] text-ink-secondary tabular-nums">
            {page + 1} / {Math.ceil(allOrders.length / pageSize)}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(Math.ceil(allOrders.length / pageSize) - 1, p + 1))}
            disabled={pageStart + pageSize >= allOrders.length}
            className="px-3.5 py-1.5 text-[12px] border border-line-subtle rounded-md bg-surface-card text-ink-primary disabled:opacity-40 disabled:cursor-default hover:bg-surface-hover transition-colors duration-fast"
          >
            Suiv. ›
          </button>
        </div>
      )}
    </div>
  );
}
