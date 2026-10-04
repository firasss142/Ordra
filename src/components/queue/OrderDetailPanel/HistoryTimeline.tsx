"use client";

import { useTranslations } from "next-intl";
import { getStatusLabel } from "@/lib/status-labels";
import { formatOrderHistoryNote } from "@/lib/order-history-display";
import { presentStatus } from "@/lib/orders/status-presentation";
import type { HistoryEntry } from "./types";

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  /** "ar" forces Arabic locale formatting (Libya orders) regardless of UI locale. */
  historyLocale: "ar" | "fr";
}

/**
 * The Historique pane (prototypes/commandes-v4.html `.tl`): the order's story
 * the way it happened, oldest first, a dot per step in that status's hue, the
 * time above each line. What the log already said stays: who did it, how long
 * the order sat before the step, and the translated note.
 *
 * Labels follow `historyLocale`: a Libya order renders Arabic inside an
 * otherwise French console, so the row's own language decides.
 */
export function HistoryTimeline({ entries, historyLocale }: HistoryTimelineProps) {
  const t = useTranslations("orders.detail");
  const th = useTranslations("orders.history");
  const isAr = historyLocale === "ar";

  /** French comes from the message catalogue; Arabic is forced per-order. */
  function label(key: PlainLabel): string {
    return isAr ? AR_LABELS[key] : th(key);
  }

  /**
   * The gap templates carry ICU placeholders, so they cannot go through the
   * plain `label()` path — next-intl rejects a parameterised message rendered
   * with no values, and returns the key path instead of the text.
   */
  function gapLabel(key: GapLabel, values: Record<string, number | string>): string {
    if (!isAr) return th(key, values);
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replace(`{${name}}`, String(value)),
      AR_LABELS[key] as string,
    );
  }

  const emptyText = isAr ? "لا يوجد سجل" : t("emptyHistory");

  function formatTransition(entry: HistoryEntry): string {
    const to = getStatusLabel(entry.to_status, historyLocale);
    if (!entry.from_status) return to;
    const from = getStatusLabel(entry.from_status, historyLocale);
    return isAr ? `${from} ← ${to}` : th("transition", { from, to });
  }

  if (entries.length === 0) {
    return <div className="tl-empty">{emptyText}</div>;
  }

  // The log arrives newest-first; the prototype reads it the way it happened,
  // oldest at the top, with where the order stands now at the bottom.
  const ordered = [...entries].reverse();

  return (
    <ul
      className="tl"
      aria-label={label("label")}
      lang={isAr ? "ar" : undefined}
      dir={isAr ? "rtl" : undefined}
    >
      {ordered.map((entry, i) => {
        const isLatest = i === ordered.length - 1;
        const face = presentStatus(entry.to_status);
        const note = formatOrderHistoryNote(entry.note, historyLocale);
        // The gap belongs to the row that ended the wait.
        const previous = ordered[i - 1];
        const gap = previous ? formatGap(previous.created_at, entry.created_at, gapLabel) : null;

        return (
          <li
            key={entry.id}
            className={`h-${face.hue}${isLatest ? " now" : ""}`}
            data-current={isLatest ? "true" : undefined}
            data-status={entry.to_status}
            data-hue={face.hue}
          >
            <time dateTime={entry.created_at}>
              {new Date(entry.created_at).toLocaleString(isAr ? "ar-LY" : "fr-TN", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {gap && <span data-testid="history-gap"> · {gap}</span>}
            </time>
            {formatTransition(entry)}
            <span className="odp-sub" data-testid="history-actor">
              {actorLabel(entry.actor_type, label)}
            </span>
            {note && <span className="odp-note">{note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Forced-Arabic copies, for Libya orders rendered inside the French console. */
const AR_LABELS = {
  label: "سجل الطلب",
  actorAgent: "الوكيل",
  actorSystem: "النظام",
  actorManager: "المدير",
  actorAdmin: "المشرف",
  actorUnknown: "—",
  current: "الحالي",
  gapMinutes: "+{m} د",
  gapHours: "+{h}س{m}",
  gapDays: "+{d} ي",
} as const;

/** Messages with ICU placeholders, and the plain ones. Kept apart because
 *  next-intl needs values for the first group and refuses them for neither. */
type GapLabel = "gapMinutes" | "gapHours" | "gapDays";
type PlainLabel = Exclude<keyof typeof AR_LABELS, GapLabel>;

type Label = (key: PlainLabel) => string;
type GapFormatter = (key: GapLabel, values: Record<string, number | string>) => string;

/**
 * `actor_type` is free text written by whichever route wrote the row, so it is
 * matched rather than switched on — an unrecognised value falls back to a dash
 * instead of leaking a raw column value into the log.
 */
function actorLabel(actorType: string | null, label: Label): string {
  const kind = (actorType ?? "").toLowerCase();
  if (kind.includes("system") || kind.includes("cron") || kind.includes("webhook")) {
    return label("actorSystem");
  }
  if (kind.includes("super_admin") || kind.includes("admin")) return label("actorAdmin");
  if (kind.includes("manager")) return label("actorManager");
  if (kind.includes("agent")) return label("actorAgent");
  return label("actorUnknown");
}

/**
 * How long the order sat before this step. Rendered from the message templates
 * rather than string concatenation so the Arabic reads right-to-left correctly.
 */
function formatGap(fromIso: string, toIso: string, gap: GapFormatter): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return null;

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return gap("gapMinutes", { m: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return gap("gapHours", { h: hours, m: String(minutes % 60).padStart(2, "0") });
  }

  return gap("gapDays", { d: Math.floor(hours / 24) });
}
