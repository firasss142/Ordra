"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Printer, CheckSquare, Square } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import { openPdfBlob } from "@/lib/pdf-utils";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { WarehousePagination } from "./WarehousePagination";
import {
  PrintActivityDashboard,
  type PrintSession,
} from "./PrintActivityDashboard";

const D = {
  pageBg: "#F6F6F7",
  cardBg: "#FFFFFF",
  sectionBg: "#F6F6F7",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  danger: "#D72C0D",
  warning: "#B98900",
  cardShadow: "0 0 0 1px #E1E3E5",
  inputBg: "#FFFFFF",
  inputBorder: "#C9CCCF",
};

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
  locale: string;
}

interface ApiResponse {
  orders: WarehouseOrderRow[];
}

export function ToLabelQueue({ marketId, fallbackRows, locale }: Props) {
  const t = useTranslations("warehouse");
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrivalCount, setArrivalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [printSession, setPrintSession] = useState<PrintSession | null>(null);

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

  useEffect(() => {
    setPage(0);
  }, [allOrders]);

  const pageStart = page * pageSize;
  const orders = useMemo(
    () => allOrders.slice(pageStart, pageStart + pageSize),
    [allOrders, pageStart, pageSize],
  );

  // allSelected: only checks current page
  const allSelected =
    orders.length > 0 && orders.every((o) => selected.has(o.id));

  // toggleAll: adds/removes current page from selection (preserves other pages' selection)
  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        orders.forEach((o) => next.delete(o.id));
      } else {
        orders.forEach((o) => next.add(o.id));
      }
      return next;
    });
  }, [orders, allSelected]);

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
      openPdfBlob(await res.blob(), `labels-${Date.now()}.pdf`);
      // Capture session BEFORE clearing selection
      const sessionOrderIds = Array.from(selected);
      const sessionOrderMap = new Map(
        allOrders
          .filter((o) => selected.has(o.id))
          .map((o) => [
            o.id,
            {
              customer_name: o.customer_name,
              customer_city: o.customer_city ?? null,
              product_name: o.product_name,
            },
          ]),
      );
      setPrintSession({
        order_ids: sessionOrderIds,
        printed_at: Date.now(),
        order_map: sessionOrderMap,
      });
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
        padding: isMobile ? "16px 16px 80px" : "24px 32px 80px",
        background: D.pageBg,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1
          style={{
            fontSize: isMobile ? 18 : 22,
            fontWeight: 600,
            color: D.textPrimary,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
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
            backgroundColor: "rgba(26,26,26,0.8)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: D.textPrimary,
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
            background: "#FFF4F4",
            border: `1px solid #FECACA`,
            borderRadius: 6,
            color: D.danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          backgroundColor: D.cardBg,
          border: `1px solid ${D.border}`,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: D.cardShadow,
        }}
      >
        {/* Sticky header */}
        <div
          style={{
            position: "sticky",
            top: 0,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            padding: "12px 16px",
            borderBottom: `1px solid ${D.border}`,
            backgroundColor: D.sectionBg,
            zIndex: 2,
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
              color: D.textPrimary,
              fontSize: 13,
              fontWeight: 600,
              opacity: orders.length === 0 ? 0.4 : 1,
              minHeight: 44,
            }}
          >
            {allSelected ? (
              <CheckSquare size={16} strokeWidth={1.5} color="#2C6ECB" aria-hidden="true" />
            ) : (
              <Square size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
            {t("toLabel.selectAll")}
          </button>

          <span
            style={{
              fontSize: 12,
              color: D.textSecondary,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {t("toLabel.selectedCount", {
              count: selected.size,
              total: allOrders.length,
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
              padding: "10px 20px",
              minHeight: 44,
              backgroundColor: selected.size === 0 || printing ? "#F6F6F7" : "#1A1A1A",
              opacity: selected.size === 0 || printing ? 0.5 : 1,
              color: selected.size === 0 || printing ? D.textSecondary : "#FFFFFF",
              border: "none",
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 700,
              cursor: selected.size === 0 || printing ? "not-allowed" : "pointer",
              transition: "background-color 150ms ease, opacity 150ms ease",
              fontFamily: "inherit",
            }}
          >
            <Printer size={14} strokeWidth={1.75} aria-hidden="true" />
            {printing
              ? t("toLabel.printing")
              : t("toLabel.printBtn", { count: selected.size })}
          </button>
        </div>

        {/* Column headers (desktop only) */}
        {!isMobile && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "40px 140px 1.3fr 1.5fr 1fr 0.8fr",
              gap: 12,
              padding: "8px 16px",
              borderBottom: `1px solid ${D.border}`,
              backgroundColor: D.sectionBg,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: D.textSecondary,
            }}
          >
            <span aria-hidden="true" />
            <span>{t("toLabel.colCity")}</span>
            <span>{t("toLabel.colCustomer")}</span>
            <span>{t("toLabel.colProduct")}</span>
            <span>{t("toLabel.colPhone")}</span>
            <span>{t("toLabel.colId")}</span>
          </div>
        )}

        {orders.length === 0 ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              color: D.textSecondary,
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
              isMobile={isMobile}
            />
          ))
        )}

        {allOrders.length > 0 && (
          <WarehousePagination
            page={page}
            pageSize={pageSize}
            totalItems={allOrders.length}
            hasNextPage={pageStart + pageSize < allOrders.length}
            hasPrevPage={page > 0}
            onNext={() => setPage((p) => p + 1)}
            onPrev={() => setPage((p) => Math.max(0, p - 1))}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(0);
            }}
            labelPrev={t("pagination.prev")}
            labelNext={t("pagination.next")}
            labelPage={
              allOrders.length > 0
                ? t("pagination.pageInfo", {
                    page: page + 1,
                    total: Math.max(1, Math.ceil(allOrders.length / pageSize)),
                    items: allOrders.length,
                  })
                : undefined
            }
          />
        )}
      </div>

      {printSession && (
        <PrintActivityDashboard
          session={printSession}
          liveOrders={allOrders}
          onDismiss={() => setPrintSession(null)}
          locale={locale}
        />
      )}
    </div>
  );
}

const ToLabelRow = memo(function ToLabelRow({
  order,
  selected,
  onToggle,
  lowStockBadge,
  criticalBadge,
  isMobile,
}: {
  order: WarehouseOrderRow;
  selected: boolean;
  onToggle: (id: string) => void;
  lowStockBadge: string;
  criticalBadge: string;
  isMobile: boolean;
}) {
  const showLow =
    order.low_stock_threshold != null &&
    order.current_stock != null &&
    order.current_stock < order.low_stock_threshold;
  const isOut = order.current_stock != null && order.current_stock <= 0;
  const stockAccent = isOut ? D.danger : D.warning;

  const StockBadge = showLow ? (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 999,
        background: isOut ? "#FFF4F4" : "#FFF8E6",
        color: stockAccent,
        border: `1px solid ${isOut ? "#FECACA" : "#FFD585"}`,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
      title={`${order.current_stock} / ${order.low_stock_threshold}`}
    >
      {isOut ? criticalBadge : lowStockBadge}
    </span>
  ) : null;

  if (isMobile) {
    return (
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "14px 16px",
          borderBottom: `1px solid ${D.border}`,
          backgroundColor: selected ? "#F2F2F2" : "transparent",
          cursor: "pointer",
          minHeight: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(order.id)}
            style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#2C6ECB" }}
          />
          <span style={{ fontWeight: 700, color: D.textPrimary, flex: 1, fontSize: 14 }}>
            {order.customer_city ?? "—"}
          </span>
          <code
            style={{
              fontSize: 11,
              color: D.textSecondary,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            #{order.id.slice(0, 8)}
          </code>
        </div>
        <div style={{ paddingInlineStart: 28, fontSize: 14, color: D.textPrimary }}>
          {order.customer_name}
        </div>
        <div
          style={{
            paddingInlineStart: 28,
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: D.textSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {order.product_name}
          </span>
          {StockBadge}
        </div>
        <div
          style={{
            paddingInlineStart: 28,
            fontSize: 13,
            color: D.textSecondary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {order.customer_phone ?? "—"}
        </div>
      </label>
    );
  }

  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "40px 140px 1.3fr 1.5fr 1fr 0.8fr",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${D.border}`,
        alignItems: "center",
        fontSize: 13,
        cursor: "pointer",
        backgroundColor: selected ? "#F2F2F2" : "transparent",
        transition: "background-color 120ms ease",
        minHeight: 44,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(order.id)}
        style={{ cursor: "pointer", accentColor: "#2C6ECB" }}
      />
      <div style={{ fontWeight: 700, color: D.textPrimary }}>
        {order.customer_city ?? "—"}
      </div>
      <div style={{ color: D.textPrimary }}>{order.customer_name}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          style={{
            color: D.textSecondary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {order.product_name}
        </span>
        {StockBadge}
      </div>
      <div style={{ color: D.textSecondary, fontVariantNumeric: "tabular-nums" }}>
        {order.customer_phone ?? "—"}
      </div>
      <code
        style={{
          fontSize: 11,
          color: D.textSecondary,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        }}
      >
        #{order.id.slice(0, 8)}
      </code>
    </label>
  );
});
