"use client";

import { useTranslations, useLocale } from "next-intl";
import { formatDateTime } from "@/lib/format";

/**
 * A small status dot that inherits the pill's text color (currentColor), so it
 * always pairs with its tone — the same dot language as the StatusSign pills.
 */
function Dot({ filled = true }: { filled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "h-1.5 w-1.5 rounded-full",
        filled ? "bg-current" : "border border-current",
      ].join(" ")}
    />
  );
}

interface Props {
  status: string;
  attemptsCount: number;
  maxAttempts?: number;
  callbackAt: string | null;
  scheduledDispatchAt?: string | null;
  scheduledDispatchAuto?: boolean;
  now?: Date;
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

// A contained pill — same shape language as the Confirmé / Téléchargé status
// signs, so every queue card reads its state from a consistent chip.
const BASE =
  "inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-[11px] font-bold tracking-[0.04em] whitespace-nowrap border";

// Tonal containers per state.
const TONE_NEUTRAL =
  "bg-agent-surface-high text-agent-on-surface border-agent-outline-variant";
const TONE_ATTEMPT =
  "bg-status-warningBg text-status-warning border-status-warning/30";
// Final attempt: same amber family as the other tentatives, just a darker,
// denser fill so it reads as the most urgent without switching to red.
const TONE_FINAL =
  "bg-status-warning/20 text-status-warning border-status-warning/60";
const TONE_CRITICAL =
  "bg-status-criticalBg text-status-critical border-status-critical/40";

export function AttemptEtiquette({
  status,
  attemptsCount,
  maxAttempts = 3,
  callbackAt,
  scheduledDispatchAt,
  scheduledDispatchAuto,
  now,
}: Props) {
  const t = useTranslations("queue.etiquette");
  const locale = useLocale();

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
      <span role="note" aria-label={label} className={`${BASE} ${TONE_CRITICAL}`}>
        <Dot />
        <span>{label}</span>
      </span>
    );
  }

  if (isFutureCallback && callbackDate) {
    const time = formatHM(callbackDate, locale);
    const label = t("callbackAt", { time });
    return (
      <span role="note" aria-label={label} className={`${BASE} ${TONE_NEUTRAL}`}>
        <Dot filled={false} />
        <span>{label}</span>
      </span>
    );
  }

  if (isOverdueDispatch) {
    const label = t("dispatchOverdue");
    return (
      <span role="note" aria-label={label} className={`${BASE} ${TONE_CRITICAL}`}>
        <Dot />
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
      <span role="note" aria-label={label} className={`${BASE} ${TONE_NEUTRAL}`}>
        <Dot filled={false} />
        <span>{label}</span>
      </span>
    );
  }

  const n = attemptNumberFor(status, attemptsCount);
  if (n !== null) {
    const isFinal = n >= maxAttempts;
    const label = t("attempt", { n });
    return (
      <span
        role="note"
        aria-label={label}
        className={[
          BASE,
          isFinal ? `${TONE_FINAL} animate-pulse` : TONE_ATTEMPT,
        ].join(" ")}
      >
        <Dot />
        <span>{label}</span>
        {isFinal && <span className="font-bold">{t("attemptFinal")}</span>}
      </span>
    );
  }

  return null;
}
