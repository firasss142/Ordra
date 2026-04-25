"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { playBeep } from "@/components/warehouse/ScanFeedbackTile";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

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

  useEffect(() => {
    if (!submitting && !disabled) inputRef.current?.focus();
  }, [submitting, disabled]);

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

  const feedbackChrome =
    feedback.kind === "success"
      ? "border-2 border-status-success bg-status-successBg"
      : feedback.kind === "error"
        ? "border-2 border-status-critical bg-status-criticalBg"
        : feedback.kind === "neutral"
          ? "border-2 border-status-warning bg-status-warningBg"
          : "border-2 border-dashed border-line bg-surface-card";

  return (
    <div className="flex flex-col gap-3 p-4 h-full">
      <div className="flex gap-2 items-center">
        <ScanLine size={18} strokeWidth={1.5} className="text-ink-secondary shrink-0" />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              submit(value);
            }
          }}
          placeholder={labels.inputPlaceholder}
          disabled={submitting || disabled}
          autoComplete="off"
          spellCheck={false}
          aria-label={labels.inputPlaceholder}
          className="flex-1 font-mono text-[13px] px-3 py-2 border border-line rounded-md bg-surface-card text-ink-primary outline-none"
        />
      </div>

      <div
        aria-live="polite"
        className={`rounded-card px-4 py-5 flex items-center gap-3 min-h-[80px] transition-all duration-base ${feedbackChrome}`}
      >
        {feedback.kind === "idle" && (
          <>
            <Clock size={24} strokeWidth={1.5} className="text-ink-secondary" />
            <span className="text-[14px] text-ink-secondary">{labels.feedbackIdle}</span>
          </>
        )}
        {feedback.kind === "success" && (
          <>
            <CheckCircle2 size={24} className="text-status-success shrink-0" />
            <div>
              <div className="font-bold text-[15px] text-ink-primary">
                {feedback.customer}
              </div>
              <div className="text-[12px] text-ink-secondary tabular-nums">
                #{feedback.shortId} ·{" "}
                {labels.stockAfter.replace("{stock}", String(feedback.stockAfter))}
              </div>
            </div>
          </>
        )}
        {feedback.kind === "neutral" && (
          <>
            <AlertTriangle size={24} strokeWidth={1.5} className="text-status-warning shrink-0" />
            <div>
              <div className="font-semibold text-[14px] text-ink-primary">
                {feedback.message}
              </div>
              <div className="text-[12px] text-ink-secondary">#{feedback.shortId}</div>
            </div>
          </>
        )}
        {feedback.kind === "error" && (
          <>
            <XCircle size={24} className="text-status-critical shrink-0" />
            <div>
              <div className="font-bold text-[15px] text-status-critical">
                {feedback.errorLabel}
              </div>
              <div className="text-[12px] text-ink-secondary">#{feedback.shortId}</div>
            </div>
          </>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold text-ink-secondary uppercase tracking-[0.05em] mb-1.5">
          {labels.recentTitle}
        </div>
        {recent.length === 0 ? (
          <div className="text-[12px] text-ink-secondary py-2">
            {labels.recentEmpty}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {recent.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] ${r.errorCode ? "bg-status-criticalBg" : "bg-status-successBg"}`}
              >
                {r.errorCode ? (
                  <XCircle size={13} className="text-status-critical shrink-0" />
                ) : (
                  <CheckCircle2 size={13} className="text-status-success shrink-0" />
                )}
                <span className="font-mono text-ink-secondary shrink-0">
                  {r.shortId}
                </span>
                <span className="text-ink-primary flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {r.customer}
                </span>
                {r.stockAfter !== undefined && (
                  <span
                    className={`tabular-nums ${r.stockAfter <= 5 ? "text-status-critical" : "text-ink-secondary"} ${r.stockAfter === 0 ? "font-bold" : ""}`}
                  >
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
