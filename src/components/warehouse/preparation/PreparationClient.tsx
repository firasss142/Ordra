"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { usePreparationTray } from "@/hooks/usePreparationTray";
import { useOperatorStats } from "@/hooks/useOperatorStats";
import { summarizeCycleTimes } from "@/lib/preparation/cycle-time";
import { openPdfBlob } from "@/lib/pdf-utils";
import { PreparationTray } from "./PreparationTray";
import { WarehouseShell } from "@/components/warehouse/shell/WarehouseShell";
import { WarehouseKpiStrip, type KpiTile } from "@/components/warehouse/shell/WarehouseKpiStrip";
import { PreparationScannerPanel } from "./PreparationScannerPanel";
import { PreparationBacklog } from "./PreparationBacklog";
import type { ScanResult } from "./PreparationScannerPanel";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

function formatCycle(secs: number): string {
  if (secs === 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}min` : `${m}min ${s}s`;
}

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
  labels: {
    pageTitle: string;
    pageSubtitle: string;
    stageBacklog: string;
    stageTray: string;
    stageScanner: string;
    stats: {
      labelsPrinted: string;
      ordersScanned: string;
      avgCycle: string;
      traySize: string;
    };
    tray: {
      empty: string;
      printBtn: string;
      printing: string;
      selectAll: string;
      progress: string;
      traySizeWarning: string;
    };
    scanner: {
      inputPlaceholder: string;
      feedbackIdle: string;
      recentTitle: string;
      recentEmpty: string;
      stockAfter: string;
    };
    backlog: {
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
  };
}

interface StageHeaderProps {
  index: number;
  label: string;
}

function StageHeader({ index, label }: StageHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line-subtle bg-surface-hover shrink-0">
      <span
        className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-ink-primary text-white text-[12px] font-bold shrink-0 tabular-nums"
        aria-hidden="true"
      >
        {index}
      </span>
      <h2 className="m-0 text-[14px] font-semibold text-ink-primary">{label}</h2>
    </div>
  );
}

export function PreparationClient({ marketId, fallbackRows, labels }: Props) {
  const {
    rows,
    selectedIds,
    add,
    remove,
    markAllPrinted,
    onScanSuccess,
    onScanError,
    onRetry,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
  } = usePreparationTray();

  const { stats, mutate: refreshStats } = useOperatorStats();
  const [printing, setPrinting] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cycleSummary = useMemo(() => summarizeCycleTimes(rows), [rows]);
  const trayIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);

  const flashRow = useCallback((id: string) => {
    setFlashId(id);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashId(null), 400);
  }, []);

  const handleAddToTray = useCallback(
    (row: WarehouseOrderRow) => {
      add({
        id: row.id,
        shortId: row.id.slice(0, 8).toUpperCase(),
        city: row.customer_city ?? "—",
        customer: row.customer_name,
        productLabel: `${row.product_name}${row.variant_label ? ` — ${row.variant_label}` : ""} ×${row.quantity}`,
        quantity: row.quantity,
        stockLevel: row.current_stock ?? 0,
      });
    },
    [add],
  );

  const handlePrint = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || printing) return;
    setPrinting(true);
    try {
      const res = await fetch("/api/warehouse/label-prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_ids: ids }),
      });
      if (!res.ok) return;
      const batchId = res.headers.get("X-Batch-Id") ?? String(Date.now());
      openPdfBlob(await res.blob(), `labels-${batchId.slice(0, 8)}.pdf`);
      markAllPrinted(ids);
      clearSelection();
      refreshStats();
    } finally {
      setPrinting(false);
    }
  }, [selectedIds, printing, markAllPrinted, clearSelection, refreshStats]);

  const handleScan = useCallback(
    async (orderId: string): Promise<ScanResult> => {
      try {
        const res = await fetch("/api/warehouse/scan-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
        });
        const json = await res.json().catch(() => ({}));

        if (res.ok) {
          const row = rows.find((r) => r.id === orderId);
          if (row) {
            onScanSuccess(row.id, json.stock_after ?? 0);
            flashRow(row.id);
          }
          refreshStats();
          return {
            ok: true,
            stockAfter: json.stock_after ?? 0,
            customer: json.customer_name ?? orderId.slice(0, 8),
            orderId,
          };
        }

        const errorCode: ScanErrorCode = json.error_code ?? "ORDER_NOT_FOUND";
        const row = rows.find((r) => r.id === orderId);
        if (row) onScanError(row.id, errorCode);

        return { ok: false, errorCode, message: json.message ?? "", orderId };
      } catch {
        const row = rows.find((r) => r.id === orderId);
        if (row) onScanError(row.id, "NETWORK_ERROR");
        return { ok: false, errorCode: "NETWORK_ERROR", message: "Network error", orderId };
      }
    },
    [rows, onScanSuccess, onScanError, flashRow, refreshStats],
  );

  const handleReprint = useCallback(
    async (id: string) => {
      setPrinting(true);
      try {
        const res = await fetch("/api/warehouse/label-prints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_ids: [id] }),
        });
        if (!res.ok) return;
        openPdfBlob(await res.blob(), `label-reprint-${Date.now()}.pdf`);
        onRetry(id);
        markAllPrinted([id]);
        refreshStats();
      } finally {
        setPrinting(false);
      }
    },
    [onRetry, markAllPrinted, refreshStats],
  );

  const cycleSeconds =
    cycleSummary.count > 0 ? cycleSummary.avgSeconds : stats.avg_cycle_seconds;

  const kpiTiles: KpiTile[] = [
    { label: labels.stats.labelsPrinted, value: String(stats.labels_printed_today) },
    { label: labels.stats.ordersScanned, value: String(stats.orders_scanned_today) },
    { label: labels.stats.avgCycle, value: formatCycle(cycleSeconds) },
    {
      label: labels.stats.traySize,
      value: String(rows.length),
      tone: rows.length >= 100 ? "warning" : "neutral",
    },
  ];

  return (
    <WarehouseShell
      title={labels.pageTitle}
      subtitle={labels.pageSubtitle}
      kpiStrip={<WarehouseKpiStrip tiles={kpiTiles} />}
    >
      {/* 3-stage horizontal workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(320px,380px)] gap-4 items-stretch">
        {/* STAGE 1 — Backlog */}
        <section className="bg-surface-card border border-line-subtle rounded-card overflow-hidden flex flex-col">
          <StageHeader index={1} label={labels.stageBacklog} />
          <div className="p-4 overflow-auto max-h-[720px]">
            <PreparationBacklog
              marketId={marketId}
              fallbackRows={fallbackRows}
              trayIds={trayIds}
              onAddToTray={handleAddToTray}
              labels={labels.backlog}
            />
          </div>
        </section>

        {/* STAGE 2 — Tray (print) */}
        <section className="bg-surface-card border border-line-subtle rounded-card overflow-hidden flex flex-col">
          <StageHeader index={2} label={labels.stageTray} />
          <div className="flex-1 overflow-y-auto max-h-[720px] relative">
            <PreparationTray
              rows={rows}
              selectedIds={selectedIds}
              onToggle={toggleSelect}
              onToggleAll={toggleSelectAll}
              onRemove={remove}
              onRetry={onRetry}
              onReprint={handleReprint}
              onPrint={handlePrint}
              printing={printing}
              flashId={flashId}
              labels={labels.tray}
            />
          </div>
        </section>

        {/* STAGE 3 — Scanner (sticky, elevated) */}
        <aside className="bg-surface-card border border-line-subtle rounded-card overflow-hidden flex flex-col sticky top-4 self-start max-h-[calc(100vh-32px)] shadow-panel">
          <StageHeader index={3} label={labels.stageScanner} />
          <div className="flex-1 overflow-y-auto">
            <PreparationScannerPanel
              onScan={handleScan}
              labels={labels.scanner}
            />
          </div>
        </aside>
      </div>
    </WarehouseShell>
  );
}
