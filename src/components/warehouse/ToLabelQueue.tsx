"use client";

import { memo, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Printer, CheckSquare, Square } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
}

interface ApiResponse {
  orders: WarehouseOrderRow[];
}

export function ToLabelQueue({ marketId, fallbackRows }: Props) {
  const t = useTranslations("warehouse");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const orders = useMemo(() => data?.orders ?? [], [data]);

  const allSelected =
    orders.length > 0 && orders.every((o) => selected.has(o.id));

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === orders.length && orders.length > 0
        ? new Set()
        : new Set(orders.map((o) => o.id)),
    );
  }, [orders]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePrint = async () => {
    if (selected.size === 0 || printing) return;
    setPrinting(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/label-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? t("errors.printFailed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `labels-${Date.now()}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 100);
      setSelected(new Set());
      mutate();
    } catch {
      setError(t("errors.network"));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div
      style={{
        padding: "24px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("toLabel.title")}
        </h1>
      </div>

      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => {
          setArrivalCount(0);
          mutate();
        }}
        onDismiss={() => setArrivalCount(0)}
        labels={{
          reveal: t("banner.newReveal"),
          dismiss: t("banner.dismiss"),
        }}
      />

      {printing ? (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(246,246,247,0.88)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "#1A1A1A",
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          <Printer size={20} strokeWidth={1.5} aria-hidden="true" />
          {t("toLabel.printing")}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            padding: "10px 12px",
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 6,
            color: "#DC2626",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "14px 16px",
            borderBottom: "1px solid #E1E3E5",
            backgroundColor: "#FFFFFF",
            zIndex: 1,
          }}
        >
          <button
            type="button"
            onClick={toggleAll}
            disabled={orders.length === 0}
            aria-label={t("toLabel.selectAll")}
            style={{
              all: "unset",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: orders.length === 0 ? "not-allowed" : "pointer",
              color: "#1A1A1A",
              fontSize: 13,
              fontWeight: 600,
              opacity: orders.length === 0 ? 0.5 : 1,
            }}
          >
            {allSelected ? (
              <CheckSquare size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Square size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
            {t("toLabel.selectAll")}
          </button>
          <span style={{ fontSize: 12, color: "#6D7175" }}>
            {t("toLabel.selectedCount", {
              count: selected.size,
              total: orders.length,
            })}
          </span>
          <button
            type="button"
            onClick={handlePrint}
            disabled={selected.size === 0 || printing}
            style={{
              marginInlineStart: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              backgroundColor: "#1A1A1A",
              opacity: selected.size === 0 || printing ? 0.4 : 1,
              color: "#FFFFFF",
              border: "none",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor:
                selected.size === 0 || printing ? "not-allowed" : "pointer",
              transition: "background-color 120ms ease",
            }}
          >
            <Printer size={14} strokeWidth={1.5} aria-hidden="true" />
            {printing
              ? t("toLabel.printing")
              : t("toLabel.printBtn", { count: selected.size })}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "40px 140px 1.3fr 1.5fr 1fr 0.8fr",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid #E1E3E5",
            backgroundColor: "#F7F7F7",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "#6D7175",
          }}
        >
          <span aria-hidden="true" />
          <span>{t("toLabel.colCity")}</span>
          <span>{t("toLabel.colCustomer")}</span>
          <span>{t("toLabel.colProduct")}</span>
          <span>{t("toLabel.colPhone")}</span>
          <span>{t("toLabel.colId")}</span>
        </div>

        {orders.length === 0 ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              color: "#6D7175",
              fontSize: 14,
            }}
          >
            {t("toLabel.empty")}
          </div>
        ) : (
          orders.map((o) => (
            <ToLabelRow
              key={o.id}
              order={o}
              selected={selected.has(o.id)}
              onToggle={toggleOne}
              lowStockBadge={t("lowStock.badge")}
              criticalBadge={t("lowStock.critical")}
            />
          ))
        )}
      </div>
    </div>
  );
}

const ToLabelRow = memo(function ToLabelRow({
  order,
  selected,
  onToggle,
  lowStockBadge,
  criticalBadge,
}: {
  order: WarehouseOrderRow;
  selected: boolean;
  onToggle: (id: string) => void;
  lowStockBadge: string;
  criticalBadge: string;
}) {
  const showLow =
    order.low_stock_threshold != null &&
    order.current_stock != null &&
    order.current_stock < order.low_stock_threshold;
  const isOut = order.current_stock != null && order.current_stock <= 0;
  const accent = isOut ? "#D72C0D" : "#B98900";

  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "40px 140px 1.3fr 1.5fr 1fr 0.8fr",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid #E1E3E5",
        alignItems: "center",
        fontSize: 13,
        cursor: "pointer",
        backgroundColor: selected ? "#F7F7F7" : "transparent",
        transition: "background-color 120ms ease",
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(order.id)}
        style={{ cursor: "pointer" }}
      />
      <div style={{ fontWeight: 600, color: "#1A1A1A" }}>
        {order.customer_city ?? "—"}
      </div>
      <div style={{ color: "#1A1A1A" }}>{order.customer_name}</div>
      <div
        style={{
          color: "#6D7175",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {order.product_name}
        </span>
        {showLow ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 999,
              background: isOut ? "#FFF4F4" : "#FFF8E6",
              color: accent,
              border: `1px solid ${isOut ? "#FECACA" : "#FDE68A"}`,
              flexShrink: 0,
            }}
            title={`${order.current_stock} / ${order.low_stock_threshold}`}
          >
            {isOut ? criticalBadge : lowStockBadge}
          </span>
        ) : null}
      </div>
      <div
        style={{ color: "#6D7175", fontVariantNumeric: "tabular-nums" }}
      >
        {order.customer_phone ?? "—"}
      </div>
      <code
        style={{
          fontSize: 11,
          color: "#6D7175",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}
      >
        #{order.id.slice(0, 8)}
      </code>
    </label>
  );
});
