"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { usePreparationTray } from "@/hooks/usePreparationTray";
import { useOperatorStats } from "@/hooks/useOperatorStats";
import { summarizeCycleTimes } from "@/lib/preparation/cycle-time";
import { openPdfBlob } from "@/lib/pdf-utils";
import { PreparationStatsStrip } from "./PreparationStatsStrip";
import { PreparationTray } from "./PreparationTray";
import { PreparationScannerPanel } from "./PreparationScannerPanel";
import { PreparationBacklog } from "./PreparationBacklog";
import type { ScanResult } from "./PreparationScannerPanel";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

const D = {
  pageBg: "#F6F6F7",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
} as const;

interface Props {
  marketId: string | null;
  fallbackRows: WarehouseOrderRow[];
  labels: {
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
    trayTitle: string;
    scannerTitle: string;
  };
}

export function PreparationClient({ marketId, fallbackRows, labels }: Props) {
  // Destructure stable callbacks so useCallback deps don't blow up on every render
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

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: D.pageBg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PreparationStatsStrip
        labelsPrintedToday={stats.labels_printed_today}
        ordersScannedToday={stats.orders_scanned_today}
        avgCycleSeconds={cycleSummary.count > 0 ? cycleSummary.avgSeconds : stats.avg_cycle_seconds}
        traySize={rows.length}
        labels={labels.stats}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 380px",
          gap: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderInlineEnd: `1px solid ${D.border}`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px 10px",
              borderBottom: `1px solid ${D.border}`,
              backgroundColor: "#FAFAFA",
              flexShrink: 0,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: D.textPrimary, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {labels.trayTitle}
            </h2>
          </div>

          <div style={{ flex: 1, overflowY: "auto", backgroundColor: D.pageBg }}>
            <div style={{ height: "100%" }}>
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
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: D.pageBg,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px 10px",
              borderBottom: `1px solid ${D.border}`,
              backgroundColor: "#FAFAFA",
              flexShrink: 0,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: D.textPrimary, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {labels.scannerTitle}
            </h2>
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            <PreparationScannerPanel
              onScan={handleScan}
              labels={labels.scanner}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "24px 24px 80px",
          borderTop: `1px solid ${D.border}`,
          backgroundColor: D.pageBg,
        }}
      >
        <PreparationBacklog
          marketId={marketId}
          fallbackRows={fallbackRows}
          trayIds={trayIds}
          onAddToTray={handleAddToTray}
          labels={labels.backlog}
        />
      </div>
    </div>
  );
}
