"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle, Camera } from "lucide-react";
import { playBeep } from "@/components/warehouse/ScanFeedbackTile";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

const QrScanner = dynamic(
  () => import("@/components/warehouse/QrScanner").then((m) => m.QrScanner),
  { ssr: false },
);

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
    openCamera: string;
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
    case "CARRIER_WAREHOUSE_ORDER":
      return "Expédiée depuis l'entrepôt du transporteur — aucun scan requis";
    case "NETWORK_ERROR": return "Erreur réseau — réessayez";
    default: return "Erreur inconnue";
  }
}

export function PreparationScannerPanel({ onScan, disabled = false, labels }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" });
  const [recent, setRecent] = useState<RecentScan[]>([]);

  useEffect(() => {
    if (!submitting && !disabled && !cameraOpen) inputRef.current?.focus();
  }, [submitting, disabled, cameraOpen]);

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
    if (cameraOpen) return;
    const { handler, cleanup } = createScannerInputHandler((scanned) => {
      if (!disabled) submit(scanned);
    });
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      cleanup();
    };
  }, [submit, disabled, cameraOpen]);

  const feedbackChrome =
    feedback.kind === "success"
      ? "border-2 border-status-success bg-status-successBg"
      : feedback.kind === "error"
        ? "border-2 border-status-critical bg-status-criticalBg"
        : feedback.kind === "neutral"
          ? "border-2 border-status-warning bg-status-warningBg"
          : "border-2 border-dashed border-line bg-surface-card";

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <ScanLine
            size={18}
            strokeWidth={1.5}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
            aria-hidden
          />
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
            className="w-full font-mono text-[15px] tracking-wide ps-10 pe-3 py-3 border-2 border-line rounded-card bg-surface-page text-ink-primary outline-none focus:border-ink-primary focus:bg-surface-card transition-colors duration-fast disabled:opacity-60"
          />
        </div>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={submitting || disabled}
          aria-label={labels.openCamera}
          title={labels.openCamera}
          className="inline-flex items-center justify-center px-3 rounded-card border-2 border-line text-ink-primary bg-surface-page hover:bg-surface-hover hover:border-line-strong transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <Camera size={18} strokeWidth={1.5} aria-hidden />
        </button>
      </div>

      <div
        aria-live="polite"
        className={`rounded-card px-4 py-5 flex items-center gap-3 min-h-[92px] transition-all duration-base ${feedbackChrome}`}
      >
        {feedback.kind === "idle" && (
          <>
            <Clock size={24} strokeWidth={1.5} className="text-ink-secondary" />
            <span className="text-[14px] text-ink-secondary">{labels.feedbackIdle}</span>
          </>
        )}
        {feedback.kind === "success" && (
          <>
            <CheckCircle2 size={26} strokeWidth={1.75} className="text-status-success shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[18px] leading-tight text-ink-primary truncate">
                {feedback.customer}
              </div>
              <div className="text-[12px] text-ink-secondary tabular-nums mt-0.5">
                #{feedback.shortId} ·{" "}
                {labels.stockAfter.replace("{stock}", String(feedback.stockAfter))}
              </div>
            </div>
            <div
              className={`shrink-0 flex items-baseline gap-0.5 ps-3 border-s border-line-subtle ${
                feedback.stockAfter === 0
                  ? "text-status-critical"
                  : feedback.stockAfter <= 5
                    ? "text-status-warning"
                    : "text-status-success"
              }`}
            >
              <span className="text-[13px] font-semibold leading-none">×</span>
              <span className="text-[22px] font-bold tabular-nums leading-none">
                {feedback.stockAfter}
              </span>
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
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={12} strokeWidth={2} className="text-ink-muted shrink-0" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            {labels.recentTitle}
          </span>
          {recent.length > 0 && (
            <span className="text-[10px] text-ink-muted tabular-nums">· {recent.length}</span>
          )}
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
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] border-s-[3px] hover:shadow-hover-row hover:-translate-y-px transition-all duration-fast ${r.errorCode ? "bg-status-criticalBg border-s-status-critical" : "bg-status-successBg border-s-status-success"}`}
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

      {cameraOpen ? (
        <QrScanner
          active={cameraOpen}
          onScan={(text) => {
            setCameraOpen(false);
            submit(text);
          }}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}
