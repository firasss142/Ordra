"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Check, RotateCcw, Copy } from "lucide-react";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { classifyOrderAge, formatOrderAge, AGE_TONE } from "@/lib/orders/order-age";

export interface PanelHeaderProps {
  /** Full human reference — storefront order number, else the order id. */
  reference: string;
  /** Intake time. Drives the elapsed-time reading. */
  createdAt: string;
  /** Raw status — the aging scale escalates only while an order is still open. */
  status: string;
  /** Localised status label e.g. "Confirmé" / "مؤكد". */
  statusLabel: string;
  locale: string;
  /** Calls made — the status label stops counting at three. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`. Omit until settings load. */
  maxAttempts?: number | null;
  /** When provided, renders the "Change status" affordance next to the badge. */
  onChangeStatus?: () => void;
  /** Inline save-flash signal coming from inline-edit commits. */
  saveFlash: "saved" | "error" | null;
  /** Optional carrier-barcode pulled-back chip (e.g. "Dexpress annulé"). */
  carrierDeletedChip?: { label: string; tooltip: string } | null;
  onClose: () => void;
}

/**
 * Quiet chrome: what this order is, how long it has been waiting, and how to
 * leave. Nothing here should out-shout the customer's name below it.
 *
 * The elapsed time is the addition that matters. The list has shown it since
 * the redesign; opening an order used to drop it, so the one number that
 * decides "call now or later" disappeared at exactly the moment you act on it.
 * It shares `order-age.ts` with the row so both readings always agree.
 *
 * The reference went the other way — it was a bordered mono pill competing with
 * the status badge for something nobody reads unless they are pasting it into a
 * carrier's site. Now it is grey text with a copy button, which is the whole job.
 */
export function PanelHeader({
  reference,
  createdAt,
  status,
  statusLabel,
  locale,
  attemptsCount,
  maxAttempts,
  onChangeStatus,
  saveFlash,
  carrierDeletedChip,
  onClose,
}: PanelHeaderProps) {
  const t = useTranslations("orders.detail");
  const [copied, setCopied] = useState(false);

  const age = classifyOrderAge(createdAt, status);
  // Show the tail — the leading digits are identical across a market's orders
  // and carry no information at a glance.
  const short = reference.length > 6 ? `…${reference.slice(-5)}` : reference;

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — the value is still on screen and selectable */
    }
  }

  return (
    <div className="flex-shrink-0 border-b border-oms-border bg-oms-surface">
      <div className="flex h-[50px] items-center gap-2.5 px-[18px]">
        <OrderStatusBadge
          status={status}
          label={statusLabel}
          locale={locale}
          attemptsCount={attemptsCount}
          maxAttempts={maxAttempts}
        />

        <span
          data-testid="panel-age"
          data-tier={age.tier}
          title={new Date(createdAt).toLocaleString(locale === "ar" ? "ar-LY" : "fr-TN", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
          className={`whitespace-nowrap text-[11.5px] tabular-nums ${AGE_TONE[age.tier]}`}
        >
          {formatOrderAge(age.minutes, locale)}
        </span>

        {onChangeStatus ? (
          <button
            type="button"
            onClick={onChangeStatus}
            className="text-[11px] font-medium text-oms-ink-2 underline-offset-2 hover:text-oms-ink-1 hover:underline"
          >
            {t("changeStatus")}
          </button>
        ) : null}

        {carrierDeletedChip ? (
          <span
            className="inline-flex h-[22px] flex-shrink-0 items-center gap-1 rounded-card border border-oms-border bg-oms-sunken px-2 text-[11px] font-medium text-oms-ink-2"
            title={carrierDeletedChip.tooltip}
          >
            <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
            {carrierDeletedChip.label}
          </span>
        ) : null}

        {saveFlash === "saved" ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-oms-ok">
            <Check size={11} strokeWidth={2.5} aria-hidden="true" />
            {t("inlineSaved")}
          </span>
        ) : null}
        {saveFlash === "error" ? (
          <span className="text-[11px] text-oms-bad">{t("inlineSaveError")}</span>
        ) : null}

        {/* Reference and close sit at the trailing edge — chrome, not content. */}
        <span className="ms-auto flex flex-shrink-0 items-center gap-1">
          <span className="text-[11px] tabular-nums tracking-[0.01em] text-oms-ink-3">
            #{short}
          </span>
          <button
            type="button"
            onClick={() => void copyReference()}
            aria-label={t("copyReference")}
            title={reference}
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
          >
            {copied ? (
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Copy size={12} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-[26px] w-[26px] place-items-center rounded-[7px] text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
          >
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}
