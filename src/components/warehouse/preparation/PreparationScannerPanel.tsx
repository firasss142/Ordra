"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { playBeep } from "@/components/warehouse/ScanFeedbackTile";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

const D = {
  cardBg: "#FFFFFF",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  danger: "#D72C0D",
  successBg: "#E3F1D9",
  errorBg: "#FFF4F2",
  inputBorder: "#C9CCCF",
} as const;

export type ScanResult =
  | { ok: true; stockAfter: number; customer: string; orderId: string }
  | { ok: false; errorCode: ScanErrorCode; message: string; orderId: string };

interface RecentScan {
  id: string;
  orderId: string;
  shortId: string;
  customer: string;
  stockAfter?: number;
  errorCode?: ScanErrorCode;
  at: number;
}

interface Props {
  onScan: (orderId: string) => Promise<ScanResult>;
  disabled?: boolean;
  labels: {
    inputPlaceholder: string;
    feedbackIdle: string;
    recentTitle: string;
    recentEmpty: string;
    stockAfter: string;
  };
}

type FeedbackState =
  | { kind: "idle" }
  | { kind: "success"; customer: string; shortId: string; stockAfter: number }
  | { kind: "neutral"; shortId: string; message: string }
  | { kind: "error"; shortId: string; errorLabel: string };

function errorLabel(code: ScanErrorCode): string {
  switch (code) {
    case "ORDER_NOT_FOUND": return "Commande introuvable";
    case "MARKET_MISMATCH": return "Marché incorrect";
    case "INVALID_STATUS": return "Déjà scanné ailleurs";
    case "NO_LABEL_PRINTED": return "Étiquette manquante — imprimez d'abord";
    case "STOCK_UNDERFLOW": return "Stock insuffisant — contactez le superviseur";
    case "NETWORK_ERROR": return "Erreur réseau — réessayez";
    default: return "Erreur inconnue";
  }
}

export function PreparationScannerPanel({ onScan, disabled = false, labels }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [recent, setRecent] = useState<RecentScan[]>([]);

  // Keep input focused unless a modal is open
  useEffect(() => {
    if (!submitting && !disabled) inputRef.current?.focus();
  }, [submitting, disabled]);

  // Auto-clear feedback after 2.5 s on success/neutral
  useEffect(() => {
    if (feedback.kind !== "success" && feedback.kind !== "neutral") return;
    const id = window.setTimeout(() => setFeedback({ kind: "idle" }), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const submit = useCallback(
    async (raw: string) => {
      const orderId = raw.trim();
      if (!orderId || submitting || disabled) return;
      setSubmitting(true);
      setValue("");

      try {
        const result = await onScan(orderId);
        const shortId = orderId.slice(0, 8).toUpperCase();

        if (result.ok) {
          setFeedback({
            kind: "success",
            customer: result.customer,
            shortId,
            stockAfter: result.stockAfter,
          });
          playBeep("success");
          setRecent((prev) =>
            [
              { id: crypto.randomUUID(), orderId, shortId, customer: result.customer, stockAfter: result.stockAfter, at: Date.now() },
              ...prev,
            ].slice(0, 8),
          );
        } else if (result.errorCode === "INVALID_STATUS") {
          // Already scanned elsewhere — neutral, not an error
          setFeedback({ kind: "neutral", shortId, message: errorLabel("INVALID_STATUS") });
          playBeep("neutral");
          setRecent((prev) =>
            [
              { id: crypto.randomUUID(), orderId, shortId, customer: "—", errorCode: result.errorCode, at: Date.now() },
              ...prev,
            ].slice(0, 8),
          );
        } else {
          setFeedback({ kind: "error", shortId, errorLabel: errorLabel(result.errorCode) });
          playBeep("error");
          setRecent((prev) =>
            [
              { id: crypto.randomUUID(), orderId, shortId, customer: "—", errorCode: result.errorCode, at: Date.now() },
              ...prev,
            ].slice(0, 8),
          );
        }
      } catch {
        setFeedback({ kind: "error", shortId: raw.slice(0, 8).toUpperCase(), errorLabel: errorLabel("NETWORK_ERROR") });
        playBeep("error");
      } finally {
        setSubmitting(false);
      }
    },
    [onScan, submitting, disabled],
  );

  // Captures hardware barcode scanner keystrokes globally so focus loss doesn't break scanning
  useEffect(() => {
    const { handler, cleanup } = createScannerInputHandler((scanned) => {
      if (!disabled) submit(scanned);
    });
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      cleanup();
    };
  }, [submit, disabled]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        height: "100%",
      }}
    >
      {/* Invisible scan input (also accepts manual typing) */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <ScanLine size={18} strokeWidth={1.5} style={{ color: D.textSecondary, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              // Stop propagation so the global scanner handler doesn't also fire submit
              e.stopPropagation();
              submit(value);
            }
          }}
          placeholder={labels.inputPlaceholder}
          disabled={submitting || disabled}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            fontFamily: "monospace",
            fontSize: 13,
            padding: "8px 12px",
            border: `1px solid ${D.inputBorder}`,
            borderRadius: 6,
            backgroundColor: D.cardBg,
            color: D.textPrimary,
            outline: "none",
          }}
          aria-label={labels.inputPlaceholder}
        />
      </div>

      {/* Feedback tile */}
      <div
        aria-live="polite"
        style={{
          borderRadius: 8,
          border:
            feedback.kind === "success"
              ? `2px solid ${D.accent}`
              : feedback.kind === "error"
                ? `2px solid ${D.danger}`
                : `2px dashed ${D.border}`,
          backgroundColor:
            feedback.kind === "success"
              ? D.successBg
              : feedback.kind === "error"
                ? D.errorBg
                : D.cardBg,
          padding: "20px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 80,
          transition: "border-color 200ms, background-color 200ms",
        }}
      >
        {feedback.kind === "idle" && (
          <>
            <Clock size={24} strokeWidth={1.5} style={{ color: D.textSecondary }} />
            <span style={{ fontSize: 14, color: D.textSecondary }}>{labels.feedbackIdle}</span>
          </>
        )}
        {feedback.kind === "success" && (
          <>
            <CheckCircle2 size={24} style={{ color: D.accent, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: D.textPrimary }}>
                {feedback.customer}
              </div>
              <div style={{ fontSize: 12, color: D.textSecondary }}>
                #{feedback.shortId} ·{" "}
                {labels.stockAfter.replace("{stock}", String(feedback.stockAfter))}
              </div>
            </div>
          </>
        )}
        {feedback.kind === "neutral" && (
          <>
            <AlertTriangle size={24} strokeWidth={1.5} style={{ color: "#B98900", flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: D.textPrimary }}>
                {feedback.message}
              </div>
              <div style={{ fontSize: 12, color: D.textSecondary }}>#{feedback.shortId}</div>
            </div>
          </>
        )}
        {feedback.kind === "error" && (
          <>
            <XCircle size={24} style={{ color: D.danger, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: D.danger }}>
                {feedback.errorLabel}
              </div>
              <div style={{ fontSize: 12, color: D.textSecondary }}>#{feedback.shortId}</div>
            </div>
          </>
        )}
      </div>

      {/* Recent scans list */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: D.textSecondary,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 6,
          }}
        >
          {labels.recentTitle}
        </div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 12, color: D.textSecondary, padding: "8px 0" }}>
            {labels.recentEmpty}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 6,
                  backgroundColor: r.errorCode ? D.errorBg : D.successBg,
                  fontSize: 12,
                }}
              >
                {r.errorCode ? (
                  <XCircle size={13} style={{ color: D.danger, flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={13} style={{ color: D.accent, flexShrink: 0 }} />
                )}
                <span
                  style={{
                    fontFamily: "monospace",
                    color: D.textSecondary,
                    flexShrink: 0,
                  }}
                >
                  {r.shortId}
                </span>
                <span style={{ color: D.textPrimary, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.customer}
                </span>
                {r.stockAfter !== undefined && (
                  <span style={{ color: r.stockAfter <= 5 ? D.danger : D.textSecondary, fontWeight: r.stockAfter === 0 ? 700 : 400 }}>
                    ×{r.stockAfter}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
