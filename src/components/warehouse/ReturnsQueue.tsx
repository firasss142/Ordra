"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Camera, Inbox, Keyboard, Loader2, Package, X } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import {
  ScanFeedbackTile,
  type FeedbackState,
  playBeep,
} from "./ScanFeedbackTile";
import { WarehouseInboxBanner } from "./WarehouseInboxBanner";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { LogisticsPageHeader } from "./shared/LogisticsPageHeader";
import { LogisticsKpiStrip, type KpiTileDef } from "./shared/LogisticsKpiStrip";
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

interface SummaryResponse {
  scanned_today: number;
  damaged_today: number;
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
  const [filter, setFilter] = useState("");
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

  const { data: summary, mutate: mutateSummary } = useSWR<SummaryResponse>(
    "/api/warehouse/returns/summary",
    jsonFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  useWarehouseRealtime({
    marketId,
    page: "returns",
    onRefresh: mutate,
    onNewArrival: () => setArrivalCount((c) => c + 1),
  });

  const orders = data?.orders ?? [];
  const filteredOrders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.customer_name, o.customer_city ?? "", o.product_name, o.id]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [orders, filter]);

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
      mutateSummary();
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
      mutateSummary();
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

  const kpiTiles: KpiTileDef[] = [
    { label: t("kpi.queued"), value: String(orders.length) },
    { label: t("kpi.scannedToday"), value: String(summary?.scanned_today ?? 0) },
    {
      label: t("kpi.damagedToday"),
      value: String(summary?.damaged_today ?? 0),
      tone: summary?.damaged_today ? "warning" : "neutral",
    },
    { label: t("kpi.inBatch"), value: String(batch.length) },
  ];

  return (
    <div
      style={{
        padding: "24px 32px 24px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <LogisticsPageHeader
        title={t("title", { count: orders.length })}
        subtitle={t("hint")}
      />

      <LogisticsKpiStrip tiles={kpiTiles} />

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

      {/* Two-column workbench */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 420px)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* LEFT — Queue */}
        <section
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <header
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid #E1E3E5",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: "#1A1A1A",
              }}
            >
              {t("queueTitle", { count: filteredOrders.length })}
            </h2>
            <div
              style={{
                marginInlineStart: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                minWidth: 200,
                maxWidth: 320,
                paddingInline: 12,
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                backgroundColor: "#FAFAFA",
              }}
            >
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("filterPlaceholder")}
                aria-label={t("filterPlaceholder")}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontSize: 13,
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  color: "#1A1A1A",
                }}
              />
              {filter ? (
                <button
                  type="button"
                  onClick={() => setFilter("")}
                  aria-label="clear"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    color: "#6D7175",
                    display: "flex",
                  }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </header>

          {filteredOrders.length === 0 ? (
            <div
              style={{
                padding: "64px 24px",
                textAlign: "center",
                color: "#6D7175",
                fontSize: 14,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Inbox size={28} strokeWidth={1.2} aria-hidden="true" />
              <span>{orders.length === 0 ? t("queueEmpty") : t("noMatches")}</span>
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                maxHeight: 560,
                overflowY: "auto",
              }}
            >
              {filteredOrders.map((o) => (
                <ReturnsRow
                  key={o.id}
                  order={o}
                  active={selected?.id === o.id}
                  batched={batchedIds.has(o.id)}
                  onOpen={() => openOrder(o)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* RIGHT — Workspace (scanner + decision) */}
        <aside
          style={{
            position: "sticky",
            top: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Scanner card */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#6D7175",
                }}
              >
                {t("scanStepLabel")}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingInline: 12,
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                backgroundColor: "#FAFAFA",
              }}
            >
              <Keyboard
                size={16}
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
                disabled={submitting || Boolean(selected)}
                placeholder={t("inputPlaceholder")}
                aria-label={t("inputPlaceholder")}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  fontSize: 15,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  color: "#1A1A1A",
                }}
              />
              {submitting ? (
                <Loader2
                  size={16}
                  strokeWidth={1.5}
                  color="#6D7175"
                  className="animate-spin"
                  aria-hidden="true"
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
                justifyContent: "center",
                gap: 8,
                padding: "10px 16px",
                backgroundColor: "#FFFFFF",
                color: "#1A1A1A",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.5 : 1,
              }}
            >
              <Camera size={16} strokeWidth={1.5} aria-hidden="true" />
              {tCommon("scanner.openCamera")}
            </button>
          </div>

          {/* Decision OR feedback */}
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
            <div
              style={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                padding: 16,
              }}
            >
              <ScanFeedbackTile
                state={feedback}
                idleLabel={t("feedbackIdle")}
              />
            </div>
          )}
        </aside>
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
  active,
  batched,
  onOpen,
}: {
  order: WarehouseOrderRow;
  active: boolean;
  batched: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("warehouse.returns");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "32px 140px 1fr 1fr 100px",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid #F2F2F2",
          fontSize: 13,
          alignItems: "center",
          width: "100%",
          boxSizing: "border-box",
          backgroundColor: active ? "#F1F8FF" : "transparent",
          borderInlineStart: active
            ? "3px solid #1A1A1A"
            : batched
              ? "3px solid #008060"
              : "3px solid transparent",
        }}
      >
        <Package size={16} strokeWidth={1.5} color="#6D7175" aria-hidden="true" />
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "flex-end",
          }}
        >
          {batched ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: "#008060",
                backgroundColor: "#E3F1D9",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              {t("inBatchLabel")}
            </span>
          ) : null}
          <code
            style={{
              fontSize: 11,
              color: "#6D7175",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            #{order.id.slice(0, 8)}
          </code>
        </div>
      </button>
    </li>
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
        border: "1px solid #E1E3E5",
        borderBlockStart: "2px solid #1A1A1A",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
            {t("trayTitle", { count: items.length })}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
            {t("trayHint")}
          </div>
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

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
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
