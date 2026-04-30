"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Package,
  ScanLine,
  User,
  XCircle,
} from "lucide-react";
import { playBeep } from "@/components/warehouse/ScanFeedbackTile";
import { createScannerInputHandler } from "@/lib/preparation/scanner-input";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";
import type { ScanResult } from "./PreparationScannerPanel";
import type { TrayRow } from "@/hooks/usePreparationTray";

interface CustomerIdentity {
  customer: string;
  city: string;
  productLabel: string;
  quantity: number;
}

interface RecentEntry {
  id: string;
  orderId: string;
  shortId: string;
  customer: string;
  city: string;
  productLabel: string;
  stockAfter?: number;
  errorCode?: ScanErrorCode;
  errorLabel?: string;
  at: number;
  kind: "success" | "warning" | "error";
}

type FocusState =
  | { kind: "idle" }
  | {
      kind: "success";
      identity: CustomerIdentity;
      shortId: string;
      stockAfter: number;
    }
  | {
      kind: "warning";
      identity: Partial<CustomerIdentity>;
      shortId: string;
      message: string;
    }
  | { kind: "error"; shortId: string; errorLabel: string };

interface Labels {
  inputPlaceholder: string;
  idleHeadline: string;
  idleHint: string;
  customerHeading: string;
  recentTitle: string;
  recentEmpty: string;
  stockAfterShort: string;
  stockAfterLabel: string;
  successBadge: string;
  warningBadge: string;
  errorBadge: string;
  qty: string;
  errors: Record<ScanErrorCode, string>;
}

interface Props {
  onScan: (orderId: string) => Promise<ScanResult>;
  trayRows: TrayRow[];
  labels: Labels;
}

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export function ScanFirstPreparationStage({ onScan, trayRows, labels }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [focus, setFocus] = useState<FocusState>({ kind: "idle" });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [pulse, setPulse] = useState(0);
  const [, forceTick] = useState(0);

  // Refresh time-ago labels every 15s
  useEffect(() => {
    const i = window.setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => window.clearInterval(i);
  }, []);

  // Keep input focused unless submitting
  useEffect(() => {
    if (!submitting) inputRef.current?.focus();
  }, [submitting]);

  const lookupTrayRow = useCallback(
    (orderId: string): TrayRow | undefined => {
      return trayRows.find((r) => r.id === orderId || r.id.startsWith(orderId));
    },
    [trayRows],
  );

  const submit = useCallback(
    async (raw: string) => {
      const orderId = raw.trim();
      if (!orderId || submitting) return;
      setSubmitting(true);
      setValue("");

      try {
        const result = await onScan(orderId);
        const shortId = orderId.slice(0, 8).toUpperCase();
        const tray = lookupTrayRow(orderId);

        if (result.ok) {
          const identity: CustomerIdentity = {
            customer: result.customer,
            city: tray?.city ?? "—",
            productLabel: tray?.productLabel ?? "—",
            quantity: tray?.quantity ?? 1,
          };
          setFocus({
            kind: "success",
            identity,
            shortId,
            stockAfter: result.stockAfter,
          });
          setPulse((n) => n + 1);
          playBeep("success");
          setRecent((prev) =>
            [
              {
                id: crypto.randomUUID(),
                orderId,
                shortId,
                customer: result.customer,
                city: identity.city,
                productLabel: identity.productLabel,
                stockAfter: result.stockAfter,
                at: Date.now(),
                kind: "success" as const,
              },
              ...prev,
            ].slice(0, 12),
          );
        } else if (result.errorCode === "INVALID_STATUS") {
          const errorLabel = labels.errors[result.errorCode];
          setFocus({
            kind: "warning",
            identity: {
              customer: tray?.customer,
              city: tray?.city,
              productLabel: tray?.productLabel,
            },
            shortId,
            message: errorLabel,
          });
          playBeep("neutral");
          setRecent((prev) =>
            [
              {
                id: crypto.randomUUID(),
                orderId,
                shortId,
                customer: tray?.customer ?? "—",
                city: tray?.city ?? "—",
                productLabel: tray?.productLabel ?? "—",
                errorCode: result.errorCode,
                errorLabel,
                at: Date.now(),
                kind: "warning" as const,
              },
              ...prev,
            ].slice(0, 12),
          );
        } else {
          const errorLabel = labels.errors[result.errorCode];
          setFocus({ kind: "error", shortId, errorLabel });
          playBeep("error");
          setRecent((prev) =>
            [
              {
                id: crypto.randomUUID(),
                orderId,
                shortId,
                customer: tray?.customer ?? "—",
                city: tray?.city ?? "—",
                productLabel: tray?.productLabel ?? "—",
                errorCode: result.errorCode,
                errorLabel,
                at: Date.now(),
                kind: "error" as const,
              },
              ...prev,
            ].slice(0, 12),
          );
        }
      } catch {
        const errorLabel = labels.errors.NETWORK_ERROR;
        setFocus({
          kind: "error",
          shortId: raw.slice(0, 8).toUpperCase(),
          errorLabel,
        });
        playBeep("error");
      } finally {
        setSubmitting(false);
      }
    },
    [onScan, submitting, lookupTrayRow, labels],
  );

  // Hardware scanner buffered keystrokes
  useEffect(() => {
    const { handler, cleanup } = createScannerInputHandler((scanned) => {
      submit(scanned);
    });
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      cleanup();
    };
  }, [submit]);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-5">
      {/* Centered scan input — the focal point */}
      <div className="bg-surface-card border border-line rounded-card shadow-panel p-6 sm:p-8">
        <div className="max-w-[640px] mx-auto flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-ink-secondary">
            <ScanLine size={20} strokeWidth={1.5} />
            <span className="text-[12px] font-bold uppercase tracking-[0.07em]">
              {labels.idleHeadline}
            </span>
          </div>
          <div className="relative w-full">
            <ScanLine
              size={20}
              strokeWidth={1.5}
              className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
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
              disabled={submitting}
              autoComplete="off"
              spellCheck={false}
              aria-label={labels.inputPlaceholder}
              className="w-full font-mono text-[18px] sm:text-[20px] tracking-wide ps-12 pe-4 py-4 border-2 border-line rounded-card bg-surface-page text-ink-primary outline-none focus:border-ink-primary focus:bg-surface-card transition-colors duration-fast"
            />
          </div>
          <p className="text-[12px] text-ink-secondary text-center m-0">{labels.idleHint}</p>
        </div>
      </div>

      {/* Customer-identity focus card */}
      <FocusCard focus={focus} pulse={pulse} labels={labels} />

      {/* Recent timeline */}
      <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line-subtle flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">
            {labels.recentTitle}
          </span>
          {recent.length > 0 && (
            <span className="text-[11px] text-ink-muted tabular-nums">· {recent.length}</span>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-ink-secondary">
            {labels.recentEmpty}
          </div>
        ) : (
          <ul className="list-none m-0 p-0 max-h-[420px] overflow-y-auto">
            {recent.map((r) => (
              <RecentRow
                key={r.id}
                entry={r}
                ageLabel={timeAgo(r.at, now)}
                qtyLabel={labels.qty}
                stockLabel={labels.stockAfterShort}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FocusCard({
  focus,
  pulse,
  labels,
}: {
  focus: FocusState;
  pulse: number;
  labels: Labels;
}) {
  if (focus.kind === "idle") {
    return (
      <div className="bg-surface-card border-2 border-dashed border-line rounded-card p-8 sm:p-10 flex flex-col items-center justify-center gap-3 min-h-[200px]">
        <ScanLine size={36} strokeWidth={1.25} className="text-ink-muted" aria-hidden />
        <p className="m-0 text-[14px] text-ink-secondary text-center max-w-[420px]">
          {labels.idleHint}
        </p>
      </div>
    );
  }

  if (focus.kind === "error") {
    return (
      <div
        key={`err-${focus.shortId}`}
        role="alert"
        aria-live="assertive"
        className="bg-status-criticalBg border-2 border-status-critical rounded-card p-6 sm:p-8 flex items-center gap-5 min-h-[180px] animate-[scanPop_240ms_ease-out]"
      >
        <XCircle size={48} strokeWidth={1.5} className="text-status-critical shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-status-critical mb-1">
            {labels.errorBadge}
          </div>
          <div className="text-[20px] sm:text-[22px] font-bold text-status-critical leading-tight">
            {focus.errorLabel}
          </div>
          <div className="text-[13px] text-ink-secondary font-mono mt-1.5">
            #{focus.shortId}
          </div>
        </div>
      </div>
    );
  }

  if (focus.kind === "warning") {
    return (
      <div
        key={`warn-${focus.shortId}`}
        role="status"
        aria-live="polite"
        className="bg-status-warningBg border-2 border-status-warning rounded-card p-6 sm:p-8 flex items-center gap-5 min-h-[180px] animate-[scanPop_240ms_ease-out]"
      >
        <AlertTriangle
          size={48}
          strokeWidth={1.5}
          className="text-status-warning shrink-0"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-status-warning mb-1">
            {labels.warningBadge}
          </div>
          <div className="text-[20px] sm:text-[22px] font-bold text-ink-primary leading-tight truncate">
            {focus.identity.customer ?? "—"}
          </div>
          <div className="text-[14px] text-status-warning font-medium mt-1.5">
            {focus.message}
          </div>
          <div className="text-[12px] text-ink-secondary font-mono mt-1">
            #{focus.shortId}
          </div>
        </div>
      </div>
    );
  }

  // success
  const { identity, shortId, stockAfter } = focus;
  const stockTone =
    stockAfter === 0
      ? "text-status-critical"
      : stockAfter <= 5
        ? "text-status-warning"
        : "text-status-success";

  return (
    <div
      key={`ok-${pulse}`}
      role="status"
      aria-live="polite"
      className="bg-surface-card border-2 border-status-success rounded-card overflow-hidden shadow-panel animate-[scanPop_240ms_ease-out]"
    >
      <div className="px-5 py-2.5 bg-status-successBg border-b border-status-success/30 flex items-center gap-2">
        <CheckCircle2 size={16} strokeWidth={1.75} className="text-status-success" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.07em] text-status-success">
          {labels.successBadge}
        </span>
        <span className="text-[11px] text-ink-secondary font-mono ms-auto tabular-nums">
          #{shortId}
        </span>
      </div>
      <div className="p-6 sm:p-7 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-center">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary mb-1.5">
            {labels.customerHeading}
          </div>
          <div className="text-[24px] sm:text-[28px] font-bold text-ink-primary leading-tight truncate">
            {identity.customer}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-ink-secondary">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} strokeWidth={1.5} className="text-ink-muted" aria-hidden />
              <span className="text-ink-primary font-medium">{identity.city}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Package size={14} strokeWidth={1.5} className="text-ink-muted shrink-0" aria-hidden />
              <span className="text-ink-primary truncate">{identity.productLabel}</span>
            </span>
            {identity.quantity > 1 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-surface-page text-ink-primary text-[12px] font-semibold tabular-nums">
                ×{identity.quantity}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-1 shrink-0 md:border-s md:border-line-subtle md:ps-6">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-status-criticalBg text-status-critical text-[22px] font-bold tabular-nums">
            −1
          </span>
          <div className="md:text-end">
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">
              {labels.stockAfterLabel}
            </div>
            <div className={`text-[24px] font-bold tabular-nums ${stockTone}`}>
              {stockAfter}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentRow({
  entry,
  ageLabel,
  qtyLabel: _qtyLabel,
  stockLabel,
}: {
  entry: RecentEntry;
  ageLabel: string;
  qtyLabel: string;
  stockLabel: string;
}) {
  const accent =
    entry.kind === "success"
      ? "border-s-status-success bg-status-successBg/40"
      : entry.kind === "warning"
        ? "border-s-status-warning bg-status-warningBg/40"
        : "border-s-status-critical bg-status-criticalBg/40";
  const Icon =
    entry.kind === "success" ? CheckCircle2 : entry.kind === "warning" ? AlertTriangle : XCircle;
  const iconClass =
    entry.kind === "success"
      ? "text-status-success"
      : entry.kind === "warning"
        ? "text-status-warning"
        : "text-status-critical";

  return (
    <li
      className={`grid grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 px-4 py-2.5 border-b border-line-subtle border-s-[3px] ${accent} items-center text-[13px]`}
    >
      <Icon size={15} strokeWidth={1.75} className={`${iconClass} shrink-0`} aria-hidden />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <User size={12} strokeWidth={1.5} className="text-ink-muted shrink-0" aria-hidden />
          <span className="font-semibold text-ink-primary truncate">{entry.customer}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <MapPin size={11} strokeWidth={1.5} className="text-ink-muted shrink-0" aria-hidden />
          <span className="text-ink-secondary text-[12px] truncate">{entry.city}</span>
        </div>
      </div>
      <div className="text-ink-secondary text-[12px] truncate min-w-0" title={entry.productLabel}>
        {entry.productLabel}
      </div>
      <div className="min-w-0">
        {entry.kind === "success" && entry.stockAfter !== undefined ? (
          <span
            className={`text-[12px] font-semibold tabular-nums ${entry.stockAfter <= 5 ? "text-status-critical" : "text-ink-primary"}`}
          >
            {stockLabel.replace("{stock}", String(entry.stockAfter))}
          </span>
        ) : entry.errorLabel ? (
          <span
            className={`text-[12px] font-medium ${entry.kind === "error" ? "text-status-critical" : "text-status-warning"} truncate inline-block max-w-full`}
            title={entry.errorLabel}
          >
            {entry.errorLabel}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 ms-auto">
        <code className="text-[11px] font-mono text-ink-muted tabular-nums">
          #{entry.shortId}
        </code>
        <span className="text-[11px] text-ink-muted tabular-nums w-10 text-end">{ageLabel}</span>
      </div>
    </li>
  );
}
