"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import {
  useWarehouseQueue,
  type WarehouseQueuePage,
} from "@/hooks/useWarehouseQueue";
import { WarehouseInboxBanner } from "@/components/warehouse/WarehouseInboxBanner";
import { Badge } from "@/components/ui/Badge";

interface Props {
  marketId: string | null;
  fallbackPage: WarehouseQueuePage;
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
    loadMore: string;
    loadingMore: string;
  };
}

const PAGE_SIZE = 10;

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
  fallbackPage,
  trayIds,
  onAddToTray,
  labels,
}: Props) {
  const [page, setPage] = useState(0);
  const [arrivalCount, setArrivalCount] = useState(0);

  const {
    orders: allOrders,
    hasMore,
    loadingMore,
    loadMore,
    mutate,
  } = useWarehouseQueue({
    endpoint: "/api/warehouse/to-label",
    fallbackFirstPage: fallbackPage,
  });

  useWarehouseRealtime({
    marketId,
    page: "to-label",
    onRefresh: mutate,
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  useEffect(() => {
    const visibleEnd = (page + 1) * PAGE_SIZE;
    if (hasMore && !loadingMore && visibleEnd >= allOrders.length) {
      loadMore();
    }
  }, [page, allOrders.length, hasMore, loadingMore, loadMore]);

  const safePage =
    allOrders.length > 0
      ? Math.min(page, Math.ceil(allOrders.length / PAGE_SIZE) - 1)
      : 0;
  const pageStart = safePage * PAGE_SIZE;
  const pageOrders = useMemo(
    () => allOrders.slice(pageStart, pageStart + PAGE_SIZE),
    [allOrders, pageStart],
  );

  const handleAdd = useCallback(
    (row: WarehouseOrderRow) => onAddToTray(row),
    [onAddToTray],
  );

  const totalKnown = allOrders.length;
  const totalPagesKnown = Math.max(1, Math.ceil(totalKnown / PAGE_SIZE));
  const canGoNext = pageStart + PAGE_SIZE < totalKnown || hasMore;
  const canGoPrev = safePage > 0;

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
          {labels.title} ({totalKnown}{hasMore ? "+" : ""})
        </h2>
      </div>

      <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
        {totalKnown === 0 ? (
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

      {totalKnown > PAGE_SIZE || hasMore ? (
        <div className="flex justify-center gap-2 items-center">
          <button
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={!canGoPrev}
            className="px-3.5 py-1.5 text-[12px] border border-line-subtle rounded-md bg-surface-card text-ink-primary disabled:opacity-40 disabled:cursor-default hover:bg-surface-hover transition-colors duration-fast"
          >
            ‹ Préc.
          </button>
          <span className="text-[12px] text-ink-secondary tabular-nums">
            {safePage + 1} / {totalPagesKnown}{hasMore ? "+" : ""}
          </span>
          <button
            onClick={() => setPage(safePage + 1)}
            disabled={!canGoNext || loadingMore}
            className="px-3.5 py-1.5 text-[12px] border border-line-subtle rounded-md bg-surface-card text-ink-primary disabled:opacity-40 disabled:cursor-default hover:bg-surface-hover transition-colors duration-fast"
          >
            {loadingMore ? labels.loadingMore : "Suiv. ›"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
