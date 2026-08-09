"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, CirclePause, Download, X } from "lucide-react";

interface Props {
  selectedCount: number;
  loading: boolean;
  canToggleActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onExport: () => void;
  onClear: () => void;
}

/**
 * Bulk bar, rendered INSIDE the table card between the rows and the pagination
 * rather than floating over the viewport. It replaces the pagination's visual
 * slot only while a selection exists, so it never covers a row the user is
 * trying to read.
 *
 * NOTE — there is deliberately no "Supprimer". Products have no hard delete:
 * `is_active` IS the soft delete, and `orders.product_id` references products
 * with ON DELETE SET NULL, so a real DELETE would detach order history and
 * silently change every profitability figure that has already been reported.
 * Deactivation is the destructive action available here, and it is reversible.
 */
export function BulkActionBar({
  selectedCount,
  loading,
  canToggleActive,
  onActivate,
  onDeactivate,
  onExport,
  onClear,
}: Props) {
  const t = useTranslations("products");
  if (selectedCount === 0) return null;

  const btn =
    "inline-flex h-[34px] items-center gap-2 rounded-[9px] border border-transparent bg-transparent px-3 text-[13px] font-medium text-ink-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      role="toolbar"
      aria-label={t("bulk.label")}
      className="flex flex-wrap items-center gap-1 border-t border-line-subtle bg-surface-card p-[13px_18px]"
    >
      <span className="inline-flex items-center gap-2.5 whitespace-nowrap pe-3 text-[14px] font-semibold tabular-nums text-ink-primary">
        <span aria-hidden className="block h-2.5 w-2.5 flex-none rounded-full bg-prod-pos" />
        {t("bulk.selected", { count: selectedCount })}
      </span>
      <span aria-hidden className="mx-2 block h-6 w-px bg-line-subtle" />

      {canToggleActive && (
        <>
          <button type="button" onClick={onActivate} disabled={loading} className={btn}>
            <CircleCheck size={14} strokeWidth={2} aria-hidden />
            {t("activate")}
          </button>
          <button type="button" onClick={onDeactivate} disabled={loading} className={btn}>
            <CirclePause size={14} strokeWidth={2} aria-hidden />
            {t("deactivate")}
          </button>
        </>
      )}

      <button type="button" onClick={onExport} disabled={loading} className={btn}>
        <Download size={14} strokeWidth={2} aria-hidden />
        {t("exportCsv")}
      </button>

      <button
        type="button"
        onClick={onClear}
        aria-label={t("bulk.clear")}
        className="ms-auto grid h-[29px] w-[29px] place-items-center rounded-[8px] text-ink-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary"
      >
        <X size={14} strokeWidth={2.3} />
      </button>
    </div>
  );
}
