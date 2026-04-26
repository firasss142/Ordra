"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Check, X, Power } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  loading: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  loading,
  onActivate,
  onDeactivate,
  onClear,
}: BulkActionBarProps) {
  const t = useTranslations("products");

  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("bulk.confirmTitle")}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-pill border border-line bg-surface-card px-3 py-2 shadow-floating">
        <span className="inline-flex items-center gap-2 ps-2 pe-3 text-[13px] font-medium text-ink-primary">
          <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-pill bg-ink-primary px-1.5 text-[11px] font-semibold text-white tabular-nums">
            {selectedCount}
          </span>
          {t("bulk.selectedCount", { count: selectedCount })}
        </span>

        <span aria-hidden className="h-5 w-px bg-line" />

        <button
          type="button"
          onClick={onActivate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-pill bg-ink-primary px-3 py-1.5 text-[13px] font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check size={14} strokeWidth={2.25} />
          {t("bulk.activate")}
        </button>

        <button
          type="button"
          onClick={onDeactivate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-card px-3 py-1.5 text-[13px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Power size={14} strokeWidth={2} />
          {t("bulk.deactivate")}
        </button>

        <span aria-hidden className="h-5 w-px bg-line" />

        <button
          type="button"
          onClick={onClear}
          disabled={loading}
          aria-label={t("bulk.clear")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-ink-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
