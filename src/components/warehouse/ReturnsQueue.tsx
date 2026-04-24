"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Camera, Keyboard, Loader2, X } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import {
  ScanFeedbackTile,
  type FeedbackState,
  playBeep,
} from "./ScanFeedbackTile";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import {
  ReturnsDecisionCard,
  type DecisionPayload,
  type ReturnRate,
} from "./ReturnsDecisionCard";

const QrScanner = dynamic(
  () => import("./QrScanner").then((m) => m.QrScanner),
  { ssr: false },
);

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
}

interface ApiResponse {
  orders: WarehouseOrderRow[];
}

interface BatchResult {
  order_id: string;
  ok: boolean;
  error?: string;
  balance_after?: number;
  is_damaged?: boolean;
}

export function ReturnsQueue({ marketId, fallbackRows }: Props) {
  const t = useTranslations("warehouse.returns");
  const tBatch = useTranslations("warehouse.returns.batch");
  const tCommon = useTranslations("warehouse");
  const [value, setValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [selected, setSelected] = useState<WarehouseOrderRow | null>(null);
  const [rate, setRate] = useState<ReturnRate | null>(null);
  const [batch, setBatch] = useState<DecisionPayload[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [arrivalCount, setArrivalCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, mutate } = useSWR<ApiResponse>(
    "/api/warehouse/returns",
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
    page: "returns",
    onRefresh: mutate,
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  const orders = data?.orders ?? [];
  const batchedIds = useMemo(
    () => new Set(batch.map((b) => b.order_id)),
    [batch],
  );
  const rateCache = useRef(new Map<string, ReturnRate>());

  useEffect(() => {
    if (!submitting && !cameraOpen && !selected) inputRef.current?.focus();
  }, [submitting, cameraOpen, selected]);

  useEffect(() => {
    if (feedback.kind !== "success") return;
    const id = window.setTimeout(() => setFeedback({ kind: "idle" }), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const fetchRate = useCallback(async (productId: string | null) => {
    if (!productId) {
      setRate(null);
      return;
    }
    const cached = rateCache.current.get(productId);
    if (cached) {
      setRate(cached);
      return;
    }
    try {
      const res = await fetch(
        `/api/warehouse/returns/rate?product_id=${encodeURIComponent(productId)}`,
      );
      if (!res.ok) {
        setRate(null);
        return;
      }
      const json = await res.json();
      const first = (json.rates ?? [])[0];
      const computed: ReturnRate = first
        ? {
            returned: first.returned ?? 0,
            damaged: first.damaged ?? 0,
            total: first.total ?? 0,
            return_rate_percent: first.return_rate_percent ?? 0,
          }
        : { returned: 0, damaged: 0, total: 0, return_rate_percent: 0 };
      rateCache.current.set(productId, computed);
      setRate(computed);
    } catch {
      setRate(null);
    }
  }, []);

  const openOrder = useCallback(
    (order: WarehouseOrderRow) => {
      setSelected(order);
      fetchRate(order.product_id);
    },
    [fetchRate],
  );

  const resolveById = (rawId: string): WarehouseOrderRow | null => {
    const id = rawId.trim();
    if (!id) return null;
    return orders.find((o) => o.id === id || o.id.startsWith(id)) ?? null;
  };

  const handleScan = (raw: string) => {
    const found = resolveById(raw);
    if (!found) {
      setFeedback({
        kind: "error",
        title: tCommon("errors.scanFailed"),
        subtitle: `#${raw.slice(0, 8)}`,
      });
      playBeep("error");
      return;
    }
    setValue("");
    openOrder(found);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleScan(value);
    }
  };

  const postSingle = async (p: DecisionPayload) => {
    const res = await fetch("/api/warehouse/scan-return", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: p.order_id,
        is_damaged: p.is_damaged,
        return_reason: p.return_reason,
        return_reason_note: p.return_reason_note,
        return_photo_url: p.return_photo_url,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "scan failed");
    return json as { balance_after: number; is_damaged: boolean };
  };

  const commitSingle = async (payload: DecisionPayload) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const json = await postSingle(payload);
      setFeedback({
        kind: "success",
        title: payload.customer_name ?? payload.order_id.slice(0, 8),
        subtitle: payload.is_damaged
          ? `${t("damagedBadge")} · #${payload.order_id.slice(0, 8)}`
          : `#${payload.order_id.slice(0, 8)}`,
        meta: payload.is_damaged
          ? t("damagedCount", { count: json.balance_after ?? 0 })
          : t("stockAfter", { stock: json.balance_after ?? 0 }),
      });
      playBeep("success");
      setSelected(null);
      setRate(null);
      mutate();
    } catch (err) {
      setFeedback({
        kind: "error",
        title: err instanceof Error ? err.message : tCommon("errors.scanFailed"),
        subtitle: `#${payload.order_id.slice(0, 8)}`,
      });
      playBeep("error");
    } finally {
      setSubmitting(false);
    }
  };

  const addToBatch = (payload: DecisionPayload) => {
    setBatch((prev) => {
      const without = prev.filter((p) => p.order_id !== payload.order_id);
      return [...without, payload];
    });
    setSelected(null);
    setRate(null);
  };

  const removeFromBatch = (orderId: string) => {
    setBatch((prev) => prev.filter((p) => p.order_id !== orderId));
  };

  const clearBatch = () => setBatch([]);

  const commitBatch = async () => {
    if (submitting || batch.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/warehouse/scan-return/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batch.map((p) => ({
            order_id: p.order_id,
            is_damaged: p.is_damaged,
            return_reason: p.return_reason,
            return_reason_note: p.return_reason_note,
            return_photo_url: p.return_photo_url,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({
          kind: "error",
          title: json.error ?? tCommon("errors.scanFailed"),
        });
        playBeep("error");
        return;
      }
      const results: BatchResult[] = json.results ?? [];
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;
      setFeedback({
        kind: failed > 0 ? "error" : "success",
        title: tBatch("summarySuccess", { count: succeeded }),
        subtitle:
          failed > 0 ? tBatch("summaryFailed", { count: failed }) : undefined,
      });
      playBeep(failed > 0 ? "error" : "success");
      setBatch((prev) =>
        prev.filter((p) => {
          const outcome = results.find((r) => r.order_id === p.order_id);
          return outcome ? !outcome.ok : true;
        }),
      );
      mutate();
    } catch {
      setFeedback({ kind: "error", title: tCommon("errors.scanFailed") });
      playBeep("error");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedAsOrder = selected
    ? {
        id: selected.id,
        customer_name: selected.customer_name,
        customer_city: selected.customer_city ?? null,
        product_id: selected.product_id,
        product_name: selected.product_name,
        quantity: selected.quantity ?? 1,
      }
    : null;

  return (
    <div
      style={{
        padding: "24px 32px 120px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title", { count: orders.length })}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>{t("hint")}</p>
      </div>

      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => {
          setArrivalCount(0);
          mutate();
        }}
        onDismiss={() => setArrivalCount(0)}
        labels={{
          reveal: tCommon("banner.newReveal"),
          dismiss: tCommon("banner.dismiss"),
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
        <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
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
            <Keyboard size={18} strokeWidth={1.5} color="#6D7175" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={submitting || Boolean(selected)}
              placeholder={t("inputPlaceholder")}
              aria-label={t("inputPlaceholder")}
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
              <Loader2 size={18} strokeWidth={1.5} color="#6D7175" className="animate-spin" aria-hidden="true" />
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
            {tCommon("scanner.openCamera")}
          </button>
        </div>
      </div>

      {selectedAsOrder ? (
        <ReturnsDecisionCard
          order={selectedAsOrder}
          rate={rate}
          onAddToBatch={addToBatch}
          onCommitNow={commitSingle}
          onCancel={() => {
            setSelected(null);
            setRate(null);
          }}
          submitting={submitting}
        />
      ) : (
        <ScanFeedbackTile state={feedback} idleLabel={t("feedbackIdle")} />
      )}

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
          {t("queueTitle", { count: orders.length })}
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
            <div style={{ padding: 40, textAlign: "center", color: "#6D7175", fontSize: 14 }}>
              {t("queueEmpty")}
            </div>
          ) : (
            orders.map((o) => (
              <ReturnsRow
                key={o.id}
                order={o}
                batched={batchedIds.has(o.id)}
                onOpen={() => openOrder(o)}
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
            handleScan(text);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}

      {batch.length > 0 ? (
        <BatchTray
          items={batch}
          submitting={submitting}
          onRemove={removeFromBatch}
          onClear={clearBatch}
          onCommit={commitBatch}
        />
      ) : null}
    </div>
  );
}

const ReturnsRow = memo(function ReturnsRow({
  order,
  batched,
  onOpen,
}: {
  order: WarehouseOrderRow;
  batched: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("warehouse.returns");
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "140px 1fr 1fr 100px 120px",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "1px solid #F2F2F2",
        fontSize: 13,
        alignItems: "center",
        width: "100%",
        boxSizing: "border-box",
        backgroundColor: batched ? "#F2F2F2" : "transparent",
      }}
    >
      <div style={{ fontWeight: 600, color: "#1A1A1A" }}>
        {order.customer_city ?? "—"}
      </div>
      <div style={{ color: "#1A1A1A" }}>{order.customer_name}</div>
      <div
        style={{
          color: "#6D7175",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {order.product_name}
      </div>
      <div style={{ fontSize: 11, color: "#6D7175", fontWeight: 600, textTransform: "uppercase" }}>
        {batched ? t("inBatchLabel") : ""}
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
    </button>
  );
});

function BatchTray({
  items,
  submitting,
  onRemove,
  onClear,
  onCommit,
}: {
  items: DecisionPayload[];
  submitting: boolean;
  onRemove: (orderId: string) => void;
  onClear: () => void;
  onCommit: () => void;
}) {
  const t = useTranslations("warehouse.returns.batch");
  return (
    <div
      style={{
        position: "sticky",
        bottom: 16,
        alignSelf: "stretch",
        backgroundColor: "#FFFFFF",
        border: "1px solid #1A1A1A",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
            {t("trayTitle", { count: items.length })}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>{t("trayHint")}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onClear}
            disabled={submitting}
            style={{
              all: "unset",
              cursor: submitting ? "not-allowed" : "pointer",
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              color: "#1A1A1A",
              borderRadius: 8,
              border: "1px solid #E1E3E5",
            }}
          >
            {t("clear")}
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={submitting}
            style={{
              all: "unset",
              cursor: submitting ? "not-allowed" : "pointer",
              padding: "8px 18px",
              fontSize: 13,
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: "#1A1A1A",
              borderRadius: 8,
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? t("committing") : t("commit", { count: items.length })}
          </button>
        </div>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it) => (
          <li
            key={it.order_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              backgroundColor: "#F7F7F7",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: it.is_damaged ? "#D72C0D" : "#008060",
              }}
              aria-hidden="true"
            />
            <code
              style={{
                fontSize: 11,
                color: "#6D7175",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                minWidth: 90,
              }}
            >
              #{it.order_id.slice(0, 8)}
            </code>
            <span style={{ flex: 1, color: "#1A1A1A" }}>
              {it.customer_name ?? it.order_id.slice(0, 8)}
            </span>
            <span style={{ color: "#6D7175", fontSize: 12 }}>
              {it.is_damaged ? it.return_reason : "restock"}
            </span>
            <button
              type="button"
              aria-label={t("remove")}
              onClick={() => onRemove(it.order_id)}
              disabled={submitting}
              style={{
                all: "unset",
                cursor: submitting ? "not-allowed" : "pointer",
                padding: 4,
                color: "#6D7175",
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
