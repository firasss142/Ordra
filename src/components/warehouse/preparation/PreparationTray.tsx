"use client";

import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Printer,
  Trash2,
  PackageOpen,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TrayRow, ScanErrorCode } from "@/lib/preparation/tray-state";

function errorLabel(code: ScanErrorCode | undefined): string {
  switch (code) {
    case "ORDER_NOT_FOUND": return "Commande introuvable";
    case "MARKET_MISMATCH": return "Marché incorrect";
    case "INVALID_STATUS": return "Statut invalide";
    case "NO_LABEL_PRINTED": return "Étiquette manquante";
    case "STOCK_UNDERFLOW": return "Stock insuffisant";
    case "NETWORK_ERROR": return "Erreur réseau";
    default: return "Erreur";
  }
}

interface StatePillProps {
  state: TrayRow["state"];
  stockLevel?: number;
}

function StatePill({ state, stockLevel }: StatePillProps) {
  if (state === "scanned") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-status-success bg-status-successBg rounded px-2 py-0.5">
        <CheckCircle2 size={12} />
        Scanné{stockLevel !== undefined ? ` · stock ${stockLevel}` : ""}
      </span>
    );
  }
  if (state === "printed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-secondary bg-status-neutralBg rounded px-2 py-0.5">
        <Clock size={12} />
        Imprimé
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-status-critical bg-status-criticalBg rounded px-2 py-0.5">
        <XCircle size={12} />
        Erreur
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-secondary bg-status-neutralBg rounded px-2 py-0.5">
      <Printer size={12} />
      À imprimer
    </span>
  );
}

interface TrayRowProps {
  row: TrayRow;
  selected: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onReprint: (id: string) => void;
  flashId: string | null;
}

function TrayRowItem({
  row,
  selected,
  onToggle,
  onRemove,
  onRetry,
  onReprint,
  flashId,
}: TrayRowProps) {
  const isFlashing = flashId === row.id;
  const errorBorder = row.state === "error";
  const flashBg = isFlashing ? "bg-status-successBg" : "bg-surface-card";
  const accentBar = errorBorder
    ? "border-s-[3px] border-s-status-critical"
    : "border-s-[3px] border-s-transparent";

  return (
    <div
      className={`grid grid-cols-[24px_1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-b border-line-subtle ${flashBg} ${accentBar} transition-colors duration-base`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(row.id)}
        disabled={row.state === "scanned"}
        aria-label={`Sélectionner ${row.shortId}`}
        className={row.state === "scanned" ? "cursor-default" : "cursor-pointer"}
      />

      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-[11px] text-ink-secondary">
            {row.shortId}
          </span>
          <span className="text-[13px] font-semibold text-ink-primary">
            {row.customer}
          </span>
          <span className="text-[12px] text-ink-secondary">{row.city}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-ink-secondary">{row.productLabel}</span>
          <StatePill state={row.state} stockLevel={row.stockLevel} />
          {row.state === "error" && row.errorReason && (
            <span className="flex items-center gap-1 text-[11px] text-status-critical">
              <AlertTriangle size={11} />
              {errorLabel(row.errorReason)}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-1">
        {row.state === "error" && (
          <>
            {row.errorReason === "NO_LABEL_PRINTED" && (
              <button
                onClick={() => onReprint(row.id)}
                title="Réimprimer l'étiquette"
                className="p-1 rounded text-status-warning hover:bg-surface-hover transition-colors duration-fast inline-flex items-center"
              >
                <Printer size={14} />
              </button>
            )}
            <button
              onClick={() => onRetry(row.id)}
              title="Réessayer"
              className="p-1 rounded text-ink-secondary hover:bg-surface-hover hover:text-ink-primary transition-colors duration-fast inline-flex items-center"
            >
              <RefreshCw size={14} />
            </button>
          </>
        )}
      </div>

      <button
        onClick={() => onRemove(row.id)}
        title="Retirer du plateau"
        aria-label={`Retirer ${row.shortId} du plateau`}
        disabled={row.state === "scanned"}
        className={`p-1 rounded inline-flex items-center transition-colors duration-fast ${row.state === "scanned" ? "text-transparent cursor-default" : "text-ink-secondary hover:bg-surface-hover hover:text-status-critical"}`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

interface PreparationTrayProps {
  rows: TrayRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onReprint: (id: string) => void;
  onPrint: () => void;
  printing: boolean;
  flashId: string | null;
  labels: {
    empty: string;
    printBtn: string;
    printing: string;
    selectAll: string;
    progress: string;
    traySizeWarning: string;
  };
}

export function PreparationTray({
  rows,
  selectedIds,
  onToggle,
  onToggleAll,
  onRemove,
  onRetry,
  onReprint,
  onPrint,
  printing,
  flashId,
  labels,
}: PreparationTrayProps) {
  const scannedCount = rows.filter((r) => r.state === "scanned").length;
  const printableRows = rows.filter(
    (r) => r.state === "ready_to_print" || r.state === "error",
  );
  const allPrintable =
    printableRows.length > 0 && printableRows.every((r) => selectedIds.has(r.id));
  const selectedCount = selectedIds.size;
  const showFloatingBar = selectedCount > 0;

  if (rows.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-ink-secondary text-[14px]"
        aria-live="polite"
      >
        <PackageOpen size={32} strokeWidth={1.2} />
        <span>{labels.empty}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line-subtle bg-surface-hover gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allPrintable}
            onChange={onToggleAll}
            aria-label={labels.selectAll}
          />
          <span className="text-[12px] text-ink-secondary tabular-nums">
            {labels.progress
              .replace("{scanned}", String(scannedCount))
              .replace("{total}", String(rows.length))}
          </span>
        </div>
        {!showFloatingBar && (
          <span className="text-[12px] text-ink-secondary">
            Sélectionnez pour imprimer
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto pb-20">
        {rows.map((row) => (
          <TrayRowItem
            key={row.id}
            row={row}
            selected={selectedIds.has(row.id)}
            onToggle={onToggle}
            onRemove={onRemove}
            onRetry={onRetry}
            onReprint={onReprint}
            flashId={flashId}
          />
        ))}
      </div>

      {/* Floating bulk action bar */}
      {showFloatingBar && (
        <div className="absolute bottom-3 inset-x-3 bg-ink-primary text-white rounded-card shadow-floating px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium tabular-nums">
            {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
          </span>
          <Button
            variant="primary"
            onClick={onPrint}
            disabled={printing}
            className="bg-white !text-ink-primary hover:bg-surface-hover"
          >
            <Printer size={14} />
            {printing
              ? labels.printing
              : labels.printBtn.replace("{count}", String(selectedCount))}
          </Button>
        </div>
      )}
    </div>
  );
}
