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
import {
  useWarehouseQueue,
  type WarehouseQueuePage,
} from "@/hooks/useWarehouseQueue";
import { WarehouseShell } from "./shell/WarehouseShell";
import { WarehouseKpiStrip, type KpiTile } from "./shell/WarehouseKpiStrip";
import {
  ReturnsDecisionCard,
  type DecisionPayload,
  type ReturnRate,
} from "./ReturnsDecisionCard";
import {
  ScanFirstReturnsStage,
  type RecentReturnEntry,
} from "./returns/ScanFirstReturnsStage";
import { ScanModeToggle, type ScanMode } from "./shared/ScanModeToggle";

const QrScanner = dynamic(
  () => import("./QrScanner").then((m) => m.QrScanner),
  { ssr: false },
);

interface Props {
  marketId: string | null;
  fallbackPage: WarehouseQueuePage;
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

export function ReturnsQueue({ marketId, fallbackPage }: Props) {
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
  const [mode, setMode] = useState<ScanMode>("scan");
  const [recent, setRecent] = useState<RecentReturnEntry[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("warehouse:returns:mode");
    if (saved === "workbench" || saved === "scan") setMode(saved);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("warehouse:returns:mode", mode);
    } catch {
      // ignore
    }
  }, [mode]);

  const pushRecent = useCallback((entry: RecentReturnEntry) => {
    setRecent((prev) => [entry, ...prev].slice(0, 12));
  }, []);

  const {
    orders,
    hasMore,
    loadingMore,
    loadMore,
    mutate,
  } = useWarehouseQueue({
    endpoint: "/api/warehouse/returns",
    fallbackFirstPage: fallbackPage,
  });

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
      setScanError(raw.slice(0, 8).toUpperCase());
      setFeedback({
        kind: "error",
        title: tCommon("errors.scanFailed"),
        subtitle: `#${raw.slice(0, 8)}`,
      });
      playBeep("error");
      return;
    }
    setScanError(null);
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
    const orderSnapshot = selected;
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
      pushRecent({
        id: crypto.randomUUID(),
        orderId: payload.order_id,
        shortId: payload.order_id.slice(0, 8).toUpperCase(),
        customer: payload.customer_name ?? "—",
        city: orderSnapshot?.customer_city ?? "—",
        productLabel: orderSnapshot
          ? `${orderSnapshot.product_name}${orderSnapshot.variant_label ? ` — ${orderSnapshot.variant_label}` : ""}`
          : "—",
        isDamaged: payload.is_damaged,
        balanceAfter: json.balance_after ?? 0,
        reason: payload.return_reason,
        at: Date.now(),
        kind: payload.is_damaged ? "damage" : "restock",
      });
      setSelected(null);
      setRate(null);
      setScanError(null);
      mutate();
      mutateSummary();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : tCommon("errors.scanFailed");
      setFeedback({
        kind: "error",
        title: message,
        subtitle: `#${payload.order_id.slice(0, 8)}`,
      });
      playBeep("error");
      pushRecent({
        id: crypto.randomUUID(),
        orderId: payload.order_id,
        shortId: payload.order_id.slice(0, 8).toUpperCase(),
        customer: payload.customer_name ?? "—",
        city: orderSnapshot?.customer_city ?? "—",
        productLabel: orderSnapshot
          ? `${orderSnapshot.product_name}${orderSnapshot.variant_label ? ` — ${orderSnapshot.variant_label}` : ""}`
          : "—",
        isDamaged: payload.is_damaged,
        balanceAfter: 0,
        at: Date.now(),
        kind: "error",
        errorMessage: message,
      });
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

  const kpiTiles: KpiTile[] = [
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
    <WarehouseShell
      title={t("title", { count: orders.length })}
      subtitle={t("hint")}
      kpiStrip={<WarehouseKpiStrip tiles={kpiTiles} />}
      actions={
        <ScanModeToggle
          mode={mode}
          onChange={setMode}
          labels={{
            scan: t("modeScan"),
            workbench: t("modeWorkbench"),
            ariaLabel: t("modeAriaLabel"),
          }}
        />
      }
    >
      <WarehouseInboxBanner
        count={arrivalCount}
        onReveal={() => {
          setArrivalCount(0);
          mutate();
        }}
        onDismiss={() => setArrivalCount(0)}
        labels={{
          reveal: tCommon("banner.newReveal", { count: arrivalCount }),
          dismiss: tCommon("banner.dismiss"),
        }}
      />

      {mode === "scan" ? (
        <div className="max-w-[960px] mx-auto w-full mt-3">
          <ScanFirstReturnsStage
            selected={selected}
            rate={rate}
            recent={recent}
            inputValue={value}
            onInputChange={setValue}
            onSubmit={handleScan}
            onOpenCamera={() => setCameraOpen(true)}
            onAddToBatch={addToBatch}
            onCommitNow={commitSingle}
            onCancel={() => {
              setSelected(null);
              setRate(null);
            }}
            submitting={submitting}
            lastError={scanError}
            labels={{
              inputPlaceholder: t("inputPlaceholder"),
              openCamera: tCommon("scanner.openCamera"),
              idleHeadline: t("scanStepLabel"),
              idleHint: t("hint"),
              customerHeading: t("customerHeading"),
              recentTitle: t("recentTitle"),
              recentEmpty: t("recentEmpty"),
              successBadge: t("scanSuccessBadge"),
              damageBadge: t("damagedBadge"),
              errorBadge: t("scanErrorBadge"),
              stockAfter: t.raw("stockAfter") as string,
              damagedAfter: t.raw("damagedCount") as string,
              stockShort: t.raw("stockShort") as string,
              damageShort: t.raw("damageShort") as string,
              notFound: tCommon("errors.scanFailed"),
            }}
          />
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)_minmax(280px,320px)] gap-4 items-start mt-3">
        {/* LEFT — Queue */}
        <section className="bg-surface-card border border-line-subtle rounded-card flex flex-col overflow-hidden">
          <header className="px-4 py-3 border-b border-line-subtle flex items-center gap-3 flex-wrap">
            <h2 className="m-0 text-[14px] font-semibold text-ink-primary tabular-nums">
              {t("queueTitle", { count: filteredOrders.length })}
            </h2>
            <div className="ms-auto flex items-center gap-2 flex-1 min-w-[200px] max-w-[320px] px-3 border border-line-subtle rounded-md bg-surface-hover">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("filterPlaceholder")}
                aria-label={t("filterPlaceholder")}
                className="flex-1 py-2 text-[13px] bg-transparent text-ink-primary outline-none border-0"
              />
              {filter ? (
                <button
                  type="button"
                  onClick={() => setFilter("")}
                  aria-label="clear"
                  className="text-ink-secondary hover:text-ink-primary inline-flex transition-colors duration-fast"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          </header>

          {filteredOrders.length === 0 ? (
            <div className="px-6 py-16 text-center text-ink-secondary text-[14px] flex flex-col items-center gap-3">
              <Inbox size={28} strokeWidth={1.2} aria-hidden="true" />
              <span>{orders.length === 0 ? t("queueEmpty") : t("noMatches")}</span>
            </div>
          ) : (
            <ul className="list-none m-0 p-0 max-h-[640px] overflow-y-auto">
              {filteredOrders.map((o) => (
                <ReturnsRow
                  key={o.id}
                  order={o}
                  active={selected?.id === o.id}
                  batched={batchedIds.has(o.id)}
                  onOpen={() => openOrder(o)}
                />
              ))}
              {hasMore && !filter ? (
                <li className="px-4 py-3 border-t border-line-subtle flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-3.5 py-1.5 text-[12px] font-medium border border-line-subtle rounded-md bg-surface-card text-ink-primary hover:bg-surface-hover transition-colors duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loadingMore ? t("loadingMore") : t("loadMore")}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </section>

        {/* CENTER — Workspace (scanner + decision/feedback) */}
        <aside className="sticky top-4 flex flex-col gap-3">
          {/* Scanner card */}
          <div className="bg-surface-card border border-line-subtle rounded-card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold tracking-[0.07em] uppercase text-ink-secondary">
                {t("scanStepLabel")}
              </span>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium text-ink-primary border border-line-subtle rounded-md hover:bg-surface-hover transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Camera size={13} strokeWidth={1.5} aria-hidden="true" />
                {tCommon("scanner.openCamera")}
              </button>
            </div>
            <div className="flex items-center gap-2 px-3 border border-line-subtle rounded-md bg-surface-hover">
              <Keyboard
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
                className="text-ink-secondary"
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
                className="flex-1 py-3 text-[15px] font-mono bg-transparent text-ink-primary outline-none border-0"
              />
              {submitting ? (
                <Loader2
                  size={16}
                  strokeWidth={1.5}
                  className="text-ink-secondary animate-spin"
                  aria-hidden="true"
                />
              ) : null}
            </div>
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
            <div className="bg-surface-card border border-line-subtle rounded-card p-4">
              <ScanFeedbackTile
                state={feedback}
                idleLabel={t("feedbackIdle")}
              />
            </div>
          )}
        </aside>

        {/* RIGHT — Batch rail (always visible) */}
        <aside className="sticky top-4">
          <BatchRail
            items={batch}
            submitting={submitting}
            onRemove={removeFromBatch}
            onClear={clearBatch}
            onCommit={commitBatch}
          />
        </aside>
      </div>
      )}

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
    </WarehouseShell>
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
  const accent = active
    ? "border-s-[3px] border-s-ink-primary bg-surface-hover"
    : batched
      ? "border-s-[3px] border-s-status-success"
      : "border-s-[3px] border-s-transparent";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`grid grid-cols-[32px_140px_1fr_1fr_100px] gap-3 px-4 py-3 border-b border-line-subtle text-[13px] items-center w-full text-start hover:bg-surface-hover transition-colors duration-fast cursor-pointer ${accent}`}
      >
        <Package size={16} strokeWidth={1.5} aria-hidden="true" className="text-ink-secondary" />
        <div className="font-semibold text-ink-primary">
          {order.customer_city ?? "—"}
        </div>
        <div className="text-ink-primary">{order.customer_name}</div>
        <div className="text-ink-secondary overflow-hidden text-ellipsis whitespace-nowrap">
          {order.product_name}
        </div>
        <div className="flex items-center gap-1.5 justify-end">
          {batched ? (
            <span className="text-[10px] font-bold tracking-[0.07em] uppercase text-status-success bg-status-successBg rounded px-1.5 py-0.5">
              {t("inBatchLabel")}
            </span>
          ) : null}
          <code className="text-[11px] text-ink-secondary font-mono tabular-nums">
            #{order.id.slice(0, 8)}
          </code>
        </div>
      </button>
    </li>
  );
});

function BatchRail({
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
  const empty = items.length === 0;
  return (
    <div
      className={[
        "bg-surface-card border rounded-card p-4 flex flex-col gap-3",
        empty ? "border-line-subtle" : "border-line-subtle shadow-panel",
      ].join(" ")}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-ink-primary tabular-nums">
            {t("trayTitle", { count: items.length })}
          </div>
          <div className="text-[12px] text-ink-secondary mt-0.5">
            {t("trayHint")}
          </div>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={onClear}
            disabled={submitting}
            className="px-2.5 py-1 text-[12px] font-medium text-ink-secondary hover:text-ink-primary hover:bg-surface-hover rounded-md transition-colors duration-fast disabled:cursor-not-allowed"
          >
            {t("clear")}
          </button>
        )}
      </div>

      {empty ? (
        <div className="text-[12px] text-ink-secondary py-6 text-center">
          —
        </div>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-1 max-h-[440px] overflow-y-auto">
          {items.map((it) => (
            <li
              key={it.order_id}
              className="flex items-center gap-2 px-2.5 py-2 bg-surface-page rounded-md text-[13px]"
            >
              <span
                aria-hidden="true"
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${it.is_damaged ? "bg-status-critical" : "bg-status-success"}`}
              />
              <code className="text-[11px] text-ink-secondary font-mono tabular-nums min-w-[70px]">
                #{it.order_id.slice(0, 8)}
              </code>
              <span className="flex-1 text-ink-primary truncate">
                {it.customer_name ?? it.order_id.slice(0, 8)}
              </span>
              <span className="text-ink-secondary text-[12px] shrink-0">
                {it.is_damaged ? it.return_reason : "restock"}
              </span>
              <button
                type="button"
                aria-label={t("remove")}
                onClick={() => onRemove(it.order_id)}
                disabled={submitting}
                className="p-1 text-ink-secondary hover:text-status-critical transition-colors duration-fast disabled:cursor-not-allowed"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!empty && (
        <button
          type="button"
          onClick={onCommit}
          disabled={submitting}
          className="w-full px-4 py-2.5 text-[13px] font-semibold text-white bg-ink-primary hover:bg-[#2A2A2A] rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-fast"
        >
          {submitting ? t("committing") : t("commit", { count: items.length })}
        </button>
      )}
    </div>
  );
}
