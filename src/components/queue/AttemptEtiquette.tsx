"use client";

import { useTranslations, useLocale } from "next-intl";
import { StatusGlyph } from "@/components/shared/StatusGlyph";
import { formatDateTime } from "@/lib/format";

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

const BASE = "inline-flex items-center gap-1.5 text-[12px] font-medium";

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
      <span role="note" aria-label={label} className={`${BASE} text-status-critical`}>
        <StatusGlyph shape="solid" />
        <span>{label}</span>
      </span>
    );
  }

  if (isFutureCallback && callbackDate) {
    const time = formatHM(callbackDate, locale);
    const label = t("callbackAt", { time });
    return (
      <span role="note" aria-label={label} className={`${BASE} text-ink-secondary`}>
        <StatusGlyph shape="ring" />
        <span>{label}</span>
      </span>
    );
  }

  if (isOverdueDispatch) {
    const label = t("dispatchOverdue");
    return (
      <span role="note" aria-label={label} className={`${BASE} text-status-critical`}>
        <StatusGlyph shape="solid" />
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
      <span role="note" aria-label={label} className={`${BASE} text-ink-secondary`}>
        <StatusGlyph shape="ring" />
        <span>{label}</span>
      </span>
    );
  }

  const n = attemptNumberFor(status, attemptsCount);
  if (n !== null) {
    const label = t("attempt", { n });
    return (
      <span role="note" aria-label={label} className={`${BASE} text-ink-primary`}>
        <StatusGlyph shape="solid" />
        <span>{label}</span>
        {n >= maxAttempts && (
          <span className="text-ink-secondary font-normal">{t("attemptFinal")}</span>
        )}
      </span>
    );
  }

  return null;
}
