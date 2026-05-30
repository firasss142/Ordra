"use client";

import { useTranslations } from "next-intl";
import { X, Check, RotateCcw } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

export interface PanelHeaderProps {
  /** Eight-char uppercase id (we slice in the parent and pass it). */
  shortId: string;
  /** Localised status label e.g. "Confirmé" / "مؤكد". */
  statusLabel: string;
  statusTone: BadgeTone;
  /** When provided, renders the "Change status" affordance next to the badge. */
  onChangeStatus?: () => void;
  /** Inline save-flash signal coming from inline-edit commits. */
  saveFlash: "saved" | "error" | null;
  /** Optional carrier-barcode pulled-back chip (e.g. "Dexpress annulé"). */
  carrierDeletedChip?: { label: string; tooltip: string } | null;
  onClose: () => void;
}

/**
 * Sticky white header band — 56px tall, no shadow, sits above the hero card.
 * Replaces the previous combo of id-pill + status-badge + change-link + save
 * flash + close button with a single composable component.
 */
export function PanelHeader({
  shortId,
  statusLabel,
  statusTone,
  onChangeStatus,
  saveFlash,
  carrierDeletedChip,
  onClose,
}: PanelHeaderProps) {
  const t = useTranslations("orders.detail");

  return (
    <div className="flex-shrink-0 bg-surface-card border-b border-line-subtle">
      <div className="flex items-center justify-between gap-3 px-4 h-[56px]">
        <div className="flex items-center gap-2 min-w-0">
          <Badge tone={statusTone} dot>
            {statusLabel}
          </Badge>
          {onChangeStatus ? (
            <button
              type="button"
              onClick={onChangeStatus}
              className="text-[11px] font-medium text-ink-secondary hover:text-ink-primary underline-offset-2 hover:underline"
            >
              {t("changeStatus")}
            </button>
          ) : null}
          <span className="inline-flex items-center h-[22px] px-2 rounded-card bg-surface-page border border-line-subtle font-mono text-[11px] font-semibold tabular-nums text-ink-secondary flex-shrink-0">
            #{shortId}
          </span>
          {carrierDeletedChip ? (
            <span
              className="inline-flex items-center gap-1 h-[22px] px-2 rounded-card border border-line-subtle bg-surface-page text-[11px] font-medium text-ink-secondary"
              title={carrierDeletedChip.tooltip}
            >
              <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
              {carrierDeletedChip.label}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {saveFlash === "saved" ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-status-success font-medium">
              <Check size={11} strokeWidth={2.5} aria-hidden="true" />
              {t("inlineSaved")}
            </span>
          ) : null}
          {saveFlash === "error" ? (
            <span className="text-[11px] text-status-critical">{t("inlineSaveError")}</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="inline-flex items-center justify-center w-8 h-8 rounded-card text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
