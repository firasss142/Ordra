"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Camera, Keyboard, Loader2 } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import {
  ScanFeedbackTile,
  type FeedbackState,
  playBeep,
} from "./ScanFeedbackTile";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { WarehousePagination } from "./WarehousePagination";

const QrScanner = dynamic(
  () => import("./QrScanner").then((m) => m.QrScanner),
  { ssr: false },
);

const D = {
  pageBg: "var(--wh-bg)",
  cardBg: "var(--wh-surface)",
  sectionBg: "var(--wh-bg)",
  border: "var(--wh-border)",
  textPrimary: "var(--wh-ink-1)",
  textSecondary: "var(--wh-ink-2)",
  accent: "var(--wh-ok)",
  danger: "var(--wh-bad)",
  warning: "var(--wh-warn)",
  cardShadow: "0 0 0 1px var(--wh-border)",
  inputBg: "var(--wh-surface)",
  inputBorder: "var(--wh-border-strong)",
};

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
}

interface RecentScan {
  id: string;
  order_id: string;
  customer_name: string;
  stock_after: number;
  at: number;
}

interface ApiResponse {
  orders: WarehouseOrderRow[];
}

export function ToScanQueue({ marketId, fallbackRows }: Props) {
  const t = useTranslations("warehouse");
  const isMobile = useIsMobile();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [arrivalCount, setArrivalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, mutate } = useSWR<ApiResponse>(
    "/api/warehouse/to-scan",
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
    page: "to-scan",
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

  useEffect(() => {
    if (!submitting && !cameraOpen) inputRef.current?.focus();
  }, [submitting, cameraOpen]);

  useEffect(() => {
    if (feedback.kind !== "success") return;
    const id = window.setTimeout(() => setFeedback({ kind: "idle" }), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const submit = async (raw: string) => {
    const orderId = raw.trim();
    if (!orderId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/warehouse/scan-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          kind: "error",
          title: json.error ?? t("errors.scanFailed"),
          subtitle: `#${orderId.slice(0, 8)}`,
        });
        playBeep("error");
        return;
      }
      const scannedName = json.customer_name ?? orderId.slice(0, 8);
      setFeedback({
        kind: "success",
        title: scannedName,
        subtitle: `#${orderId.slice(0, 8)}`,
        meta: t("toScan.stockAfter", { stock: json.stock_after ?? 0 }),
      });
      playBeep("success");
      setRecent((prev) =>
        [
          {
            id: crypto.randomUUID(),
            order_id: orderId,
            customer_name: scannedName,
            stock_after: json.stock_after ?? 0,
            at: Date.now(),
          },
          ...prev,
        ].slice(0, 8),
      );
      setValue("");
      mutate();
    } catch {
      setFeedback({ kind: "error", title: t("errors.network") });
      playBeep("error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(value);
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
          {t("toScan.title", { count: allOrders.length })}
        </h1>
        <p style={{ fontSize: 13, color: D.textSecondary, margin: "4px 0 0" }}>
          {t("toScan.hint")}
        </p>
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

      {/* Scan input card */}
      <div
        style={{
          backgroundColor: D.cardBg,
          border: `1px solid ${D.border}`,
          borderRadius: 10,
          padding: 20,
          boxShadow: D.cardShadow,
          display: "flex",
          gap: 12,
          alignItems: "stretch",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 220,
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingInline: 14,
            border: `1px solid ${D.inputBorder}`,
            borderRadius: 8,
            backgroundColor: D.inputBg,
          }}
        >
          <Keyboard size={18} strokeWidth={1.5} color={D.textSecondary} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
            placeholder={t("toScan.inputPlaceholder")}
            aria-label={t("toScan.inputPlaceholder")}
            style={{
              flex: 1,
              padding: "16px 0",
              fontSize: 18,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              color: D.textPrimary,
            }}
          />
          {submitting ? (
            <Loader2
              size={18}
              strokeWidth={1.5}
              color={D.textSecondary}
              aria-hidden="true"
              className="animate-spin"
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={submitting}
          aria-label={t("scanner.openCamera")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "0 20px",
            minHeight: 52,
            minWidth: isMobile ? "100%" : 160,
            backgroundColor: "var(--wh-ink-1)",
            color: "var(--wh-surface)",
            border: "none",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 700,
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.5 : 1,
            fontFamily: "inherit",
            transition: "opacity 150ms ease",
          }}
        >
          <Camera size={18} strokeWidth={1.75} aria-hidden="true" />
          {t("scanner.openCamera")}
        </button>
      </div>

      <ScanFeedbackTile
        state={feedback}
        idleLabel={t("toScan.feedbackIdle")}
        successColors={{ bg: "var(--wh-ok-bg)", border: "var(--wh-ok-edge)", accent: D.accent }}
        errorColors={{ bg: "var(--wh-bad-bg)", border: "var(--wh-bad-edge)", accent: D.danger }}
      />

      {recent.length > 0 ? (
        <div>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: D.textSecondary,
              margin: "0 0 8px 0",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {t("toScan.recentTitle")}
          </h2>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              backgroundColor: D.cardBg,
              border: `1px solid ${D.border}`,
              borderRadius: 10,
              overflow: "hidden",
              boxShadow: D.cardShadow,
            }}
          >
            {recent.map((r) => (
              <li
                key={r.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "12px 16px",
                  borderBottom: `1px solid ${D.border}`,
                  fontSize: 13,
                  color: D.textPrimary,
                  alignItems: "center",
                  minHeight: 44,
                }}
              >
                <span style={{ color: D.accent, fontWeight: 700, fontSize: 16, fontFamily: "inherit" }}>✓</span>
                <code
                  style={{
                    color: D.textSecondary,
                    fontSize: 12,
                    minWidth: 90,
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  }}
                >
                  #{r.order_id.slice(0, 8)}
                </code>
                <span style={{ flex: 1 }}>{r.customer_name}</span>
                <span
                  style={{
                    color: D.accent,
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                  }}
                >
                  {t("toScan.stockAfter", { stock: r.stock_after })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Queue section */}
      <div>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: D.textSecondary,
            margin: "0 0 8px 0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {t("toScan.queueTitle", { count: allOrders.length })}
        </h2>
        <div
          style={{
            backgroundColor: D.cardBg,
            border: `1px solid ${D.border}`,
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: D.cardShadow,
          }}
        >
          {/* Column headers (desktop only) */}
          {!isMobile && allOrders.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr 1fr 120px",
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
              <span>{t("toScan.colCity")}</span>
              <span>{t("toScan.colCustomer")}</span>
              <span>{t("toScan.colProduct")}</span>
              <span style={{ textAlign: "end" }}>{t("toScan.colId")}</span>
            </div>
          )}

          {orders.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: D.textSecondary,
                fontSize: 14,
              }}
            >
              {t("toScan.queueEmpty")}
            </div>
          ) : (
            orders.map((o) => (
              <ToScanRow
                key={o.id}
                order={o}
                lowBadge={t("lowStock.badge")}
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
      </div>

      {cameraOpen ? (
        <QrScanner
          active={cameraOpen}
          onScan={(text) => {
            setCameraOpen(false);
            submit(text);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}

const ToScanRow = memo(function ToScanRow({
  order,
  lowBadge,
  criticalBadge,
  isMobile,
}: {
  order: WarehouseOrderRow;
  lowBadge: string;
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
        background: isOut ? "var(--wh-bad-bg)" : "var(--wh-warn-bg)",
        color: stockAccent,
        border: `1px solid ${isOut ? "var(--wh-bad-edge)" : "var(--wh-warn-edge)"}`,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
      title={`${order.current_stock} / ${order.low_stock_threshold}`}
    >
      {isOut ? criticalBadge : lowBadge}
    </span>
  ) : null;

  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "14px 16px",
          borderBottom: `1px solid ${D.border}`,
          fontSize: 13,
          minHeight: 44,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, color: D.textPrimary, fontSize: 14 }}>
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
        <span style={{ color: D.textPrimary }}>{order.customer_name}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
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
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 1fr 120px",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${D.border}`,
        fontSize: 13,
        alignItems: "center",
        minHeight: 44,
      }}
    >
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
      <code
        style={{
          fontSize: 11,
          color: D.textSecondary,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          textAlign: "end",
        }}
      >
        #{order.id.slice(0, 8)}
      </code>
    </div>
  );
});
