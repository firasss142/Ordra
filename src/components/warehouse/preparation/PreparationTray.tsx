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
import type { TrayRow, ScanErrorCode } from "@/lib/preparation/tray-state";

const D = {
  cardBg: "#FFFFFF",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  danger: "#D72C0D",
  warning: "#B98900",
  successBg: "#E3F1D9",
  errorBorder: "#D72C0D",
} as const;

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
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          fontWeight: 600,
          color: D.accent,
          backgroundColor: D.successBg,
          borderRadius: 4,
          padding: "2px 8px",
        }}
      >
        <CheckCircle2 size={12} />
        Scanné {stockLevel !== undefined ? `· stock ${stockLevel}` : ""}
      </span>
    );
  }
  if (state === "printed") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          fontWeight: 500,
          color: D.textSecondary,
          backgroundColor: "#F6F6F7",
          borderRadius: 4,
          padding: "2px 8px",
        }}
      >
        <Clock size={12} />
        Imprimé
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          fontWeight: 600,
          color: D.danger,
          backgroundColor: "#FFF4F2",
          borderRadius: 4,
          padding: "2px 8px",
        }}
      >
        <XCircle size={12} />
        Erreur
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 500,
        color: D.textSecondary,
        backgroundColor: "#F6F6F7",
        borderRadius: 4,
        padding: "2px 8px",
      }}
    >
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

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 16px",
        borderBottom: `1px solid ${D.border}`,
        backgroundColor: isFlashing ? D.successBg : D.cardBg,
        borderInlineStart:
          row.state === "error" ? `3px solid ${D.errorBorder}` : "3px solid transparent",
        transition: "background-color 400ms ease",
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(row.id)}
        disabled={row.state === "scanned"}
        aria-label={`Sélectionner ${row.shortId}`}
        style={{ cursor: row.state === "scanned" ? "default" : "pointer" }}
      />

      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 2,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: D.textSecondary,
            }}
          >
            {row.shortId}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: D.textPrimary }}>
            {row.customer}
          </span>
          <span style={{ fontSize: 12, color: D.textSecondary }}>{row.city}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: D.textSecondary }}>
            {row.productLabel}
          </span>
          <StatePill state={row.state} stockLevel={row.stockLevel} />
          {row.state === "error" && row.errorReason && (
            <span
              style={{
                fontSize: 11,
                color: D.danger,
                display: "flex",
                alignItems: "center",
                gap: 3,
              }}
            >
              <AlertTriangle size={11} />
              {errorLabel(row.errorReason)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {row.state === "error" && (
          <>
            {row.errorReason === "NO_LABEL_PRINTED" && (
              <button
                onClick={() => onReprint(row.id)}
                title="Réimprimer l'étiquette"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: D.warning,
                  padding: 4,
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <Printer size={14} />
              </button>
            )}
            <button
              onClick={() => onRetry(row.id)}
              title="Réessayer"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: D.textSecondary,
                padding: 4,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
              }}
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
        style={{
          background: "none",
          border: "none",
          cursor: row.state === "scanned" ? "default" : "pointer",
          color: row.state === "scanned" ? "transparent" : D.textSecondary,
          padding: 4,
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          transition: "color 120ms",
        }}
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

  if (rows.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "64px 24px",
          color: D.textSecondary,
          fontSize: 14,
        }}
        aria-live="polite"
      >
        <PackageOpen size={32} strokeWidth={1.2} />
        <span>{labels.empty}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: `1px solid ${D.border}`,
          backgroundColor: "#FAFAFA",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={allPrintable}
            onChange={onToggleAll}
            aria-label={labels.selectAll}
          />
          <span style={{ fontSize: 12, color: D.textSecondary }}>
            {labels.progress
              .replace("{scanned}", String(scannedCount))
              .replace("{total}", String(rows.length))}
          </span>
        </div>
        <button
          onClick={onPrint}
          disabled={selectedIds.size === 0 || printing}
          style={{
            backgroundColor: selectedIds.size === 0 || printing ? "#C9CCCF" : D.textPrimary,
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: selectedIds.size === 0 || printing ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "background-color 120ms",
          }}
        >
          <Printer size={14} />
          {printing
            ? labels.printing
            : labels.printBtn.replace("{count}", String(selectedIds.size))}
        </button>
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: "auto" }}>
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
    </div>
  );
}

