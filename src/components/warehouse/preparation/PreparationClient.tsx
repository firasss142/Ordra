"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { usePreparationTray } from "@/hooks/usePreparationTray";
import { useOperatorStats } from "@/hooks/useOperatorStats";
import { summarizeCycleTimes } from "@/lib/preparation/cycle-time";
import { openPdfBlob } from "@/lib/pdf-utils";
import { PreparationTray } from "./PreparationTray";
import { LogisticsPageHeader } from "../shared/LogisticsPageHeader";
import { LogisticsKpiStrip, type KpiTileDef } from "../shared/LogisticsKpiStrip";
import { PreparationScannerPanel } from "./PreparationScannerPanel";
import { PreparationBacklog } from "./PreparationBacklog";
import type { ScanResult } from "./PreparationScannerPanel";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

const D = {
  pageBg: "#F6F6F7",
  cardBg: "#FFFFFF",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
} as const;

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
  hint?: string;
}

function StageHeader({ index, label, hint }: StageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 16px",
        borderBottom: `1px solid ${D.border}`,
        backgroundColor: "#FAFAFA",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          backgroundColor: D.textPrimary,
          color: "#FFFFFF",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {index}
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: D.textPrimary,
          }}
        >
          {label}
        </h2>
        {hint ? (
          <span style={{ fontSize: 11, color: D.textSecondary }}>{hint}</span>
        ) : null}
      </div>
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

  const kpiTiles: KpiTileDef[] = [
    { label: labels.stats.labelsPrinted, value: String(stats.labels_printed_today) },
    { label: labels.stats.ordersScanned, value: String(stats.orders_scanned_today) },
    { label: labels.stats.avgCycle, value: formatCycle(cycleSeconds) },
    { label: labels.stats.traySize, value: String(rows.length) },
  ];

  const cardChrome = {
    backgroundColor: D.cardBg,
    border: `1px solid ${D.border}`,
    borderRadius: 8,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  } as const;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: D.pageBg,
        padding: "24px 32px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <LogisticsPageHeader
        title={labels.pageTitle}
        subtitle={labels.pageSubtitle}
      />
      <LogisticsKpiStrip tiles={kpiTiles} />

      {/* 3-stage horizontal workbench */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.3fr) minmax(320px, 380px)",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {/* STAGE 1 — Backlog */}
        <section style={cardChrome}>
          <StageHeader index={1} label={labels.stageBacklog} />
          <div style={{ padding: 16, overflow: "auto", maxHeight: 720 }}>
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
        <section style={cardChrome}>
          <StageHeader index={2} label={labels.stageTray} />
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 720 }}>
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

        {/* STAGE 3 — Scanner */}
        <aside
          style={{
            ...cardChrome,
            position: "sticky",
            top: 16,
            alignSelf: "start",
            maxHeight: "calc(100vh - 32px)",
          }}
        >
          <StageHeader index={3} label={labels.stageScanner} />
          <div style={{ flex: 1, overflowY: "auto" }}>
            <PreparationScannerPanel
              onScan={handleScan}
              labels={labels.scanner}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
