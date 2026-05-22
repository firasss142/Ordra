"use client";

import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/format";

interface Props {
  status: string;
  attemptsCount: number;
  maxAttempts?: number;
  callbackAt: string | null;
  scheduledDispatchAt?: string | null;
  scheduledDispatchAuto?: boolean;
  now?: Date;
  /**
   * Compact mode (mobile order cards): shrinks padding/font and shortens the
   * attempt wording to "n/max", with a denser fill + pulse marking the final
   * attempt, so the badge fits under the customer name with room for the date.
   */
  compact?: boolean;
}

function attemptNumberFor(status: string, attemptsCount: number): number | null {
  if (status === "attempt_1") return attemptsCount > 0 ? attemptsCount : 1;
  if (status === "attempt_2") return attemptsCount > 0 ? attemptsCount : 2;
  if (status === "attempt_3") return attemptsCount > 0 ? attemptsCount : 3;
  if (status === "callback_scheduled" && attemptsCount > 0) {
    return attemptsCount;
  }
  return null;
}

function formatHM(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return formatDateTime(date, locale);
  }
}

// A soft, tinted pill — same quiet language as the StatusSign pills (no dot, no
// border), so every queue card reads its state from a consistent minimal chip.
const BASE =
  "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-[0.01em] whitespace-nowrap";
// Compact (mobile card) — tighter padding and smaller text so the badge
// tucks under the name and leaves room for the date beside it.
const BASE_COMPACT =
  "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-normal whitespace-nowrap";

// Tonal containers per state.
const TONE_NEUTRAL = "bg-agent-surface-high text-agent-on-surface";
const TONE_ATTEMPT = "bg-status-warningBg text-status-warning";
// Final attempt: same amber family as the other tentatives, just a darker,
// denser fill so it reads as the most urgent without switching to red.
const TONE_FINAL = "bg-status-warning/20 text-status-warning";
const TONE_CRITICAL = "bg-status-criticalBg text-status-critical";

export function AttemptEtiquette({
  status,
  attemptsCount,
  maxAttempts = 3,
  callbackAt,
  scheduledDispatchAt,
  scheduledDispatchAuto,
  now,
  compact = false,
}: Props) {
  const t = useTranslations("queue.etiquette");
  const locale = useLocale();
  const base = compact ? BASE_COMPACT : BASE;

  const referenceNow = now ?? new Date();
  const callbackDate = callbackAt ? new Date(callbackAt) : null;
  const isOverdueCallback =
    status === "callback_scheduled" &&
    callbackDate !== null &&
    callbackDate <= referenceNow;
  const isFutureCallback =
    status === "callback_scheduled" &&
    callbackDate !== null &&
    callbackDate > referenceNow;

  const dispatchDate = scheduledDispatchAt ? new Date(scheduledDispatchAt) : null;
  const isOverdueDispatch =
    status === "dispatch_scheduled" &&
    dispatchDate !== null &&
    dispatchDate <= referenceNow;
  const isFutureDispatch =
    status === "dispatch_scheduled" &&
    dispatchDate !== null &&
    dispatchDate > referenceNow;

  if (isOverdueCallback) {
    const label = t("callbackOverdue");
    return (
      <span role="note" aria-label={label} className={`${base} ${TONE_CRITICAL}`}>
        <span>{label}</span>
      </span>
    );
  }

  if (isFutureCallback && callbackDate) {
    const time = formatHM(callbackDate, locale);
    const label = t("callbackAt", { time });
    return (
      <span role="note" aria-label={label} className={`${base} ${TONE_NEUTRAL}`}>
        <span>{label}</span>
      </span>
    );
  }

  if (isOverdueDispatch) {
    const label = t("dispatchOverdue");
    return (
      <span role="note" aria-label={label} className={`${base} ${TONE_CRITICAL}`}>
        <span>{label}</span>
      </span>
    );
  }

  if (isFutureDispatch && dispatchDate) {
    const time = formatHM(dispatchDate, locale);
    const label = scheduledDispatchAuto
      ? t("dispatchAtAuto", { time })
      : t("dispatchAt", { time });
    return (
      <span role="note" aria-label={label} className={`${base} ${TONE_NEUTRAL}`}>
        <span>{label}</span>
      </span>
    );
  }

  const n = attemptNumberFor(status, attemptsCount);
  if (n !== null) {
    const isFinal = n >= maxAttempts;
    const label = t("attempt", { n });
    // Compact: collapse "Tentative 5 (dernière)" to "5/max", keeping the urgent
    // amber tone + pulse on the final attempt so the signal survives shortening.
    if (compact) {
      const shortLabel = `${n}/${maxAttempts}`;
      return (
        <span
          role="note"
          aria-label={isFinal ? `${label} ${t("attemptFinal")}` : label}
          className={[
            BASE_COMPACT,
            isFinal ? `${TONE_FINAL} animate-pulse` : TONE_ATTEMPT,
          ].join(" ")}
        >
          <span className="tabular-nums">{shortLabel}</span>
        </span>
      );
    }
    return (
      <span
        role="note"
        aria-label={label}
        className={[
          BASE,
          isFinal ? `${TONE_FINAL} animate-pulse` : TONE_ATTEMPT,
        ].join(" ")}
      >
        <span>{label}</span>
        {isFinal && <span className="ms-1 font-bold">{t("attemptFinal")}</span>}
      </span>
    );
  }

  return null;
}
