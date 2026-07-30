"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  Package,
  PackageX,
  ScanLine,
  User,
  XCircle,
} from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import {
  ReturnsDecisionCard,
  type DecisionPayload,
  type ReturnRate,
} from "@/components/warehouse/ReturnsDecisionCard";

export interface RecentReturnEntry {
  id: string;
  orderId: string;
  shortId: string;
  customer: string;
  city: string;
  productLabel: string;
  isDamaged: boolean;
  balanceAfter: number;
  reason?: string | null;
  at: number;
  kind: "restock" | "damage" | "error";
  errorMessage?: string;
}

interface Labels {
  inputPlaceholder: string;
  openCamera: string;
  idleHeadline: string;
  idleHint: string;
  customerHeading: string;
  recentTitle: string;
  recentEmpty: string;
  successBadge: string;
  damageBadge: string;
  errorBadge: string;
  stockAfter: string;
  damagedAfter: string;
  stockShort: string;
  damageShort: string;
  notFound: string;
}

interface Props {
  selected: WarehouseOrderRow | null;
  rate: ReturnRate | null;
  recent: RecentReturnEntry[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onSubmit: (raw: string) => void;
  onOpenCamera: () => void;
  onAddToBatch: (payload: DecisionPayload) => void;
  onCommitNow: (payload: DecisionPayload) => void;
  onCancel: () => void;
  submitting: boolean;
  lastError: string | null;
  labels: Labels;
}

function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h`;
}

export function ScanFirstReturnsStage({
  selected,
  rate,
  recent,
  inputValue,
  onInputChange,
  onSubmit,
  onOpenCamera,
  onAddToBatch,
  onCommitNow,
  onCancel,
  submitting,
  lastError,
  labels,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const i = window.setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => window.clearInterval(i);
  }, []);

  useEffect(() => {
    if (!submitting && !selected) inputRef.current?.focus();
  }, [submitting, selected]);

  const now = Date.now();

  return (
    <div className="flex flex-col gap-5">
      {/* Centered scan input */}
      <div className="bg-surface-card border border-line rounded-card shadow-panel p-6 sm:p-8">
        <div className="max-w-[640px] mx-auto flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-ink-secondary">
            <ScanLine size={20} strokeWidth={1.5} />
            <span className="text-[12px] font-bold uppercase tracking-[0.07em]">
              {labels.idleHeadline}
            </span>
          </div>
          <div className="relative w-full flex items-center gap-2">
            <div className="relative flex-1">
              <ScanLine
                size={20}
                strokeWidth={1.5}
                className="absolute start-4 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
                aria-hidden
              />
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSubmit(inputValue);
                  }
                }}
                disabled={submitting || Boolean(selected)}
                placeholder={labels.inputPlaceholder}
                aria-label={labels.inputPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="w-full font-mono text-[18px] sm:text-[20px] tracking-wide ps-12 pe-4 py-4 border-2 border-line rounded-card bg-surface-page text-ink-primary outline-none focus:border-ink-primary focus:bg-surface-card transition-colors duration-fast disabled:opacity-60"
              />
              {submitting && (
                <Loader2
                  size={18}
                  strokeWidth={1.5}
                  className="absolute end-4 top-1/2 -translate-y-1/2 text-ink-secondary animate-spin"
                  aria-hidden
                />
              )}
            </div>
            <button
              type="button"
              onClick={onOpenCamera}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 h-12 px-3 rounded-card border border-line text-[13px] font-medium text-ink-primary hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera size={16} strokeWidth={1.5} aria-hidden />
              <span className="hidden sm:inline">{labels.openCamera}</span>
            </button>
          </div>
          <p className="text-[12px] text-ink-secondary text-center m-0">{labels.idleHint}</p>
        </div>
      </div>

      {/* Decision panel for the actively-scanned order */}
      {selected ? (
        <div key={`sel-${selected.id}`} className="animate-[scanPop_240ms_ease-out]">
          <SelectedIdentityHeader order={selected} labels={labels} />
          <div className="mt-3">
            <ReturnsDecisionCard
              order={{
                id: selected.id,
                customer_name: selected.customer_name,
                customer_city: selected.customer_city ?? null,
                product_id: selected.product_id,
                product_name: selected.product_name,
                quantity: selected.quantity ?? 1,
              }}
              rate={rate}
              onAddToBatch={onAddToBatch}
              onCommitNow={onCommitNow}
              onCancel={onCancel}
              submitting={submitting}
            />
          </div>
        </div>
      ) : lastError ? (
        <div
          role="alert"
          className="bg-status-criticalBg border-2 border-status-critical rounded-card p-6 sm:p-8 flex items-center gap-5 animate-[scanPop_240ms_ease-out]"
        >
          <XCircle size={48} strokeWidth={1.5} className="text-status-critical shrink-0" aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-status-critical mb-1">
              {labels.errorBadge}
            </div>
            <div className="text-[18px] sm:text-[20px] font-bold text-status-critical">
              {labels.notFound}
            </div>
            <div className="text-[13px] text-ink-secondary font-mono mt-1">#{lastError}</div>
          </div>
        </div>
      ) : (
        <div className="bg-surface-card border-2 border-dashed border-line rounded-card p-8 flex flex-col items-center justify-center gap-3 min-h-[180px]">
          <ScanLine size={36} strokeWidth={1.25} className="text-ink-muted" aria-hidden />
          <p className="m-0 text-[14px] text-ink-secondary text-center max-w-[420px]">
            {labels.idleHint}
          </p>
        </div>
      )}

      {/* Recent timeline */}
      <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line-subtle flex items-center gap-1.5">
          <PackageX size={12} strokeWidth={2} className="text-ink-muted shrink-0" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            {labels.recentTitle}
          </span>
          {recent.length > 0 && (
            <span className="text-[10px] text-ink-muted tabular-nums">· {recent.length}</span>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-ink-secondary">
            {labels.recentEmpty}
          </div>
        ) : (
          <ul className="list-none m-0 p-0 max-h-[420px] overflow-y-auto">
            {recent.map((r) => (
              <RecentReturnRow
                key={r.id}
                entry={r}
                ageLabel={timeAgo(r.at, now)}
                stockShort={labels.stockShort}
                damageShort={labels.damageShort}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SelectedIdentityHeader({
  order,
  labels,
}: {
  order: WarehouseOrderRow;
  labels: Labels;
}) {
  const productLabel = `${order.product_name}${order.variant_label ? ` — ${order.variant_label}` : ""}`;
  const qty = order.quantity ?? 1;
  return (
    <div className="bg-surface-card border-2 border-ink-primary rounded-card overflow-hidden shadow-panel">
      <div className="px-5 py-2.5 bg-ink-primary text-white flex items-center gap-2">
        <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.07em]">
          {labels.successBadge}
        </span>
        <span className="text-[11px] font-mono opacity-70 ms-auto tabular-nums">
          #{order.id.slice(0, 8).toUpperCase()}
        </span>
      </div>
      <div className="p-6 sm:p-7">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary mb-1.5">
          {labels.customerHeading}
        </div>
        <div className="text-[24px] sm:text-[28px] font-bold text-ink-primary leading-tight truncate">
          {order.customer_name}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-ink-secondary">
          <span className="inline-flex items-center gap-1.5">
            <MapPin size={14} strokeWidth={1.5} className="text-ink-muted" aria-hidden />
            <span className="text-ink-primary font-medium">{order.customer_city ?? "—"}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Package
              size={14}
              strokeWidth={1.5}
              className="text-ink-muted shrink-0"
              aria-hidden
            />
            <span className="text-ink-primary truncate">{productLabel}</span>
          </span>
          {qty > 1 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-surface-page text-ink-primary text-[12px] font-semibold tabular-nums">
              ×{qty}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function RecentReturnRow({
  entry,
  ageLabel,
  stockShort,
  damageShort,
}: {
  entry: RecentReturnEntry;
  ageLabel: string;
  stockShort: string;
  damageShort: string;
}) {
  const accent =
    entry.kind === "restock"
      ? "border-s-status-success bg-status-successBg/40"
      : entry.kind === "damage"
        ? "border-s-status-warning bg-status-warningBg/40"
        : "border-s-status-critical bg-status-criticalBg/40";
  const Icon =
    entry.kind === "restock"
      ? CheckCircle2
      : entry.kind === "damage"
        ? PackageX
        : XCircle;
  const iconClass =
    entry.kind === "restock"
      ? "text-status-success"
      : entry.kind === "damage"
        ? "text-status-warning"
        : "text-status-critical";

  return (
    <li
      className={`grid grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-3 px-4 py-2.5 border-b border-line-subtle border-s-[3px] ${accent} items-center text-[13px] hover:shadow-hover-row hover:-translate-y-px transition-all duration-fast`}
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
        {entry.kind === "error" ? (
          <span
            className="text-[12px] font-medium text-status-critical truncate inline-block max-w-full"
            title={entry.errorMessage ?? ""}
          >
            {entry.errorMessage ?? "—"}
          </span>
        ) : (
          <span
            className={`text-[12px] font-semibold tabular-nums ${entry.kind === "damage" ? "text-status-warning" : "text-ink-primary"}`}
          >
            {entry.kind === "damage"
              ? damageShort.replace("{count}", String(entry.balanceAfter))
              : stockShort.replace("{stock}", String(entry.balanceAfter))}
            {entry.kind === "damage" && entry.reason ? (
              <span className="ms-1 text-ink-muted font-normal">· {entry.reason}</span>
            ) : null}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 ms-auto">
        {entry.kind === "damage" && (
          <AlertTriangle
            size={12}
            strokeWidth={1.75}
            className="text-status-warning"
            aria-hidden
          />
        )}
        <code className="text-[11px] font-mono text-ink-muted tabular-nums">
          #{entry.shortId}
        </code>
        <span className="text-[11px] text-ink-muted tabular-nums w-10 text-end">{ageLabel}</span>
      </div>
    </li>
  );
}
