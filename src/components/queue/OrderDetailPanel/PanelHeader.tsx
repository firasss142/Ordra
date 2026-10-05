"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ic, StatusPill, useWhen, type PillOrder } from "@/components/orders/commandes/ui";
import { ageTone } from "@/lib/orders/row-signals";
import { formatDateTime } from "@/lib/format";
import { ManagerPresenceMark } from "../ManagerPresenceMark";
import type { PresenceRow } from "@/hooks/useOrderLocks";
import type { RejectionBadge } from "@/hooks/useRejectionBadge";

export interface PanelHeaderProps {
  /** Full human reference — storefront order number, else the order id. */
  reference: string;
  /** The order's market — « aujourd'hui 17:20 » is read in its time zone. */
  marketId: string | null;
  /** Intake time. */
  createdAt: string;
  /** What the status pill reads: status, attempts, callback time, rejection. */
  pill: PillOrder;
  /** The market's `max_call_attempts` — « Appel 2/3 ». */
  maxAttempts: number | null;
  /** Sub-reason + group icon for a rejected order (useRejectionBadge). */
  rejection: (o: PillOrder) => RejectionBadge | null;
  locale: string;
  /** The market's confirmation target, in minutes. Null while it loads. */
  slaMinutes?: number | null;
  /** Injectable clock, for deterministic tests. */
  now?: Date;
  /** Inline save-flash signal coming from inline-edit commits. */
  saveFlash: "saved" | "error" | null;
  /** Other people in this order right now. Advisory; blocks nothing. */
  presenceRows?: PresenceRow[];
  /** A carrier reference that was pulled back (e.g. « dexpress annulé »). */
  carrierDeletedChip?: { label: string; tooltip: string } | null;
  /** « Voix du client » — sits after the reference, before the close button. */
  feedbackSlot?: ReactNode;
  /**
   * The agent's top line (prototypes/agent-shell-v2.html `panelTop`): the pill may read
   * « Tentative n/3 » (null = the shared pill), the SLA chip replaces « reçue … » and the
   * late chip, and the × goes on a phone (the back bar closes there).
   */
  agentTop?: { pill: ReactNode; sla: ReactNode; showClose: boolean };
  onClose: () => void;
}

/**
 * The drawer's top line (prototypes/commandes-v4.html `.dr-top`): status pill,
 * « reçue {when} », the late chip once the order is past its target, then the
 * reference (a copy button) and the close X at the end.
 */
export function PanelHeader({
  reference,
  marketId,
  createdAt,
  pill,
  maxAttempts,
  rejection,
  locale,
  slaMinutes = null,
  now,
  saveFlash,
  presenceRows,
  carrierDeletedChip,
  feedbackSlot,
  agentTop,
  onClose,
}: PanelHeaderProps) {
  const t = useTranslations("orders.detail");
  const when = useWhen(marketId, locale);
  const [copied, setCopied] = useState(false);
  const clock = now ?? new Date();

  const late = ageTone(
    { status: pill.status, created_at: createdAt, callback_scheduled_at: pill.callback_scheduled_at ?? null },
    slaMinutes,
    clock,
  );
  // A storefront number is short and read whole; a UUID fallback only by its tail.
  const shown = reference.length > 12 ? `…${reference.slice(-6)}` : reference;

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard denied — the value is still on screen */
    }
  }

  return (
    <div className="dr-top">
      {agentTop?.pill ?? <StatusPill o={pill} maxAttempts={maxAttempts} rejection={rejection} when={when} now={clock} />}
      {agentTop ? agentTop.sla : null}
      {agentTop ? null : <span className="dr-age" data-testid="panel-received" title={formatDateTime(createdAt, locale)}>
        {t("receivedWhen", { when: when(createdAt, { now: clock }) })}
      </span>}
      {!agentTop && late && slaMinutes != null ? (
        <span className={`sla${late === "vlate" ? " vlate" : ""}`} data-testid="panel-sla" data-state={late}>
          <Ic n="clock" />
          {t("slaLate", { h: Math.round((slaMinutes / 60) * 10) / 10 })}
        </span>
      ) : null}
      {carrierDeletedChip ? (
        <span className="pl h-neutral" title={carrierDeletedChip.tooltip}>
          <Ic n="rotate" />
          <span>{carrierDeletedChip.label}</span>
        </span>
      ) : null}
      {presenceRows && presenceRows.length > 0 ? <ManagerPresenceMark rows={presenceRows} size={16} /> : null}
      {saveFlash === "saved" ? (
        <span className="odp-saved">
          <Ic n="check" />
          {t("inlineSaved")}
        </span>
      ) : saveFlash === "error" ? (
        <span className="odp-saved bad">{t("inlineSaveError")}</span>
      ) : null}
      <span className="sp" />
      <button type="button" className="ref" onClick={() => void copyReference()} aria-label={t("copyReference")} title={reference}>
        #{shown}
        <Ic n={copied ? "check" : "copy"} />
      </button>
      {feedbackSlot}
      {agentTop && !agentTop.showClose ? null : (
        <button type="button" className="xbtn" onClick={onClose} aria-label={t("close")}>
          <Ic n="x" />
        </button>
      )}
    </div>
  );
}
