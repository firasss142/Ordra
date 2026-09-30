"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X, Check, RotateCcw, Copy, Clock } from "lucide-react";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { classifyOrderAge, formatOrderAge, AGE_TONE } from "@/lib/orders/order-age";
import { resolveSlaChip, type SlaState } from "@/lib/orders/sla";
import { formatDateTime } from "@/lib/format";
import { ManagerPresenceMark } from "../ManagerPresenceMark";
import type { PresenceRow } from "@/hooks/useOrderLocks";

/**
 * Amber while it runs, red past the target, green once it was met.
 *
 * Filled, not outlined: the chip is the one thing in this bar an agent scans
 * a column of open orders for, and an outline at 13px lost that race against
 * the status badge beside it.
 */
const SLA_TONE: Record<SlaState, string> = {
  running: "bg-oms-warn-bg text-oms-warn-ink",
  breached: "bg-oms-bad-bg text-oms-bad",
  met: "bg-oms-ok-bg text-oms-ok",
};

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
  /**
   * The market's confirmation target. Null while it loads — the chip stays out
   * and the header falls back to the plain age reading.
   */
  slaMinutes?: number | null;
  /** When the order reached `confirmed`, from its history. Freezes the chip. */
  confirmedAt?: string | null;
  /** Injectable clock, for deterministic tests. */
  now?: Date;
  /** Calls made — the status label stops counting at three. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`. Omit until settings load. */
  maxAttempts?: number | null;
  /** When provided, renders the "Change status" affordance next to the badge. */
  onChangeStatus?: () => void;
  /** Inline save-flash signal coming from inline-edit commits. */
  saveFlash: "saved" | "error" | null;
  /** Other people in this order right now. Advisory; blocks nothing. */
  presenceRows?: PresenceRow[];
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
  slaMinutes = null,
  confirmedAt = null,
  now,
  attemptsCount,
  maxAttempts,
  onChangeStatus,
  saveFlash,
  presenceRows,
  carrierDeletedChip,
  onClose,
}: PanelHeaderProps) {
  const t = useTranslations("orders.detail");
  const [copied, setCopied] = useState(false);

  const age = classifyOrderAge(createdAt, status, now?.getTime());
  const sla = resolveSlaChip({ createdAt, confirmedAt, status, slaMinutes, now });
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
      <div className="flex min-h-[46px] flex-wrap items-center gap-3 px-3.5 max-lg:py-2.5">
        <OrderStatusBadge
          status={status}
          label={statusLabel}
          locale={locale}
          attemptsCount={attemptsCount}
          maxAttempts={maxAttempts}
        />

        {/* The SLA chip states the age against a target, so the bare age would
            be the same number twice. It stays as the fallback for the stretches
            where there is no target to state it against: once the order is with
            the carrier, and while the setting is still loading. */}
        {sla ? (
          <span
            data-testid="panel-sla"
            data-state={sla.state}
            title={formatDateTime(createdAt, locale)}
            className={`inline-flex h-[30px] flex-none items-center gap-[7px] whitespace-nowrap rounded-pill px-3 text-[13.5px] font-bold ${SLA_TONE[sla.state]}`}
          >
            <Clock size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
            <span className="tabular-nums">{formatOrderAge(sla.minutes, locale)}</span>
            <span className="font-semibold opacity-80">
              · {t("slaTarget", { target: formatOrderAge(sla.targetMinutes, locale) })}
            </span>
          </span>
        ) : (
          <span
            data-testid="panel-age"
            data-tier={age.tier}
            // Shared formatter rather than a fourth local Intl call, so the
            // hover reads identically here, in the queue row and in the table.
            title={formatDateTime(createdAt, locale)}
            className={`whitespace-nowrap text-[11.5px] tabular-nums ${AGE_TONE[age.tier]}`}
          >
            {formatOrderAge(age.minutes, locale)}
          </span>
        )}

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

        {/* Who else is in here. The agent stays free to work; the ring only
            says whether the office is reading or changing something. */}
        {presenceRows && presenceRows.length > 0 ? (
          <ManagerPresenceMark rows={presenceRows} size={16} />
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
          {/* `#` + digits is a Latin run: in an Arabic panel it otherwise
              renders with the hash trailing the number. Safe to pin here —
              unlike the age beside it, this string has no localised words in
              it to reorder. */}
          <span
            dir="ltr"
            className="text-[14px] tabular-nums tracking-[0.01em] text-oms-ink-2"
          >
            #{short}
          </span>
          <button
            type="button"
            onClick={() => void copyReference()}
            aria-label={t("copyReference")}
            title={reference}
            className="grid h-8 w-8 place-items-center rounded-[8px] text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
          >
            {copied ? (
              <Check size={15} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Copy size={15} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="grid h-9 w-9 place-items-center rounded-[8px] text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1 max-lg:hidden"
          >
            <X size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}
