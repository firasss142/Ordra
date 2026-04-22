"use client";

import { memo, useEffect, useRef, useState } from "react";
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

const QrScanner = dynamic(
  () => import("./QrScanner").then((m) => m.QrScanner),
  { ssr: false },
);

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
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [arrivalCount, setArrivalCount] = useState(0);
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

  const orders = data?.orders ?? [];

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
        padding: "24px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1
          style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}
        >
          {t("toScan.title", { count: orders.length })}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
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

      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "stretch",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 260,
              display: "flex",
              alignItems: "center",
              gap: 10,
              paddingInline: 14,
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              backgroundColor: "#F7F7F7",
            }}
          >
            <Keyboard
              size={18}
              strokeWidth={1.5}
              color="#6D7175"
              aria-hidden="true"
            />
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
                color: "#1A1A1A",
              }}
            />
            {submitting ? (
              <Loader2
                size={18}
                strokeWidth={1.5}
                color="#6D7175"
                aria-hidden="true"
                className="animate-spin"
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={submitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "0 20px",
              backgroundColor: "#1A1A1A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
              minWidth: 160,
              justifyContent: "center",
            }}
          >
            <Camera size={18} strokeWidth={1.5} aria-hidden="true" />
            {t("scanner.openCamera")}
          </button>
        </div>
      </div>

      <ScanFeedbackTile state={feedback} idleLabel={t("toScan.feedbackIdle")} />

      {recent.length > 0 ? (
        <div>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6D7175",
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
              backgroundColor: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {recent.map((r) => (
              <li
                key={r.id}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid #F2F2F2",
                  fontSize: 13,
                  color: "#1A1A1A",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#008060", fontWeight: 700 }}>✓</span>
                <code
                  style={{
                    color: "#6D7175",
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
                    color: "#6D7175",
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {t("toScan.stockAfter", { stock: r.stock_after })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#6D7175",
            margin: "0 0 8px 0",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {t("toScan.queueTitle", { count: orders.length })}
        </h2>
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {orders.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#6D7175",
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
              />
            ))
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
}: {
  order: WarehouseOrderRow;
  lowBadge: string;
  criticalBadge: string;
}) {
  const showLow =
    order.low_stock_threshold != null &&
    order.current_stock != null &&
    order.current_stock < order.low_stock_threshold;
  const isOut = order.current_stock != null && order.current_stock <= 0;
  const accent = isOut ? "#D72C0D" : "#B98900";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 1fr 120px",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid #F2F2F2",
        fontSize: 13,
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 600, color: "#1A1A1A" }}>
        {order.customer_city ?? "—"}
      </div>
      <div style={{ color: "#1A1A1A" }}>{order.customer_name}</div>
      <div
        style={{
          color: "#6D7175",
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
            {isOut ? criticalBadge : lowBadge}
          </span>
        ) : null}
      </div>
      <code
        style={{
          fontSize: 11,
          color: "#6D7175",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          textAlign: "end",
        }}
      >
        #{order.id.slice(0, 8)}
      </code>
    </div>
  );
});
