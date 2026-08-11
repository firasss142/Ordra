"use client";

import { useTranslations } from "next-intl";
import { getStatusLabel } from "@/lib/status-labels";
import { formatOrderHistoryNote } from "@/lib/order-history-display";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";
import type { HistoryEntry } from "./types";

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  /** "ar" forces Arabic locale formatting (Libya orders) regardless of UI locale. */
  historyLocale: "ar" | "fr";
}

/**
 * The order's narrative, newest first.
 *
 * No card and no collapse: the tab is already the disclosure, and a card that
 * also collapses inside it made the log two clicks away from a panel that had
 * just been opened to read it.
 *
 * The rail carries four readings the text-only version made you reconstruct:
 *
 *   icon   — the destination status, wearing the SAME mark the queue pill and
 *            the console badge wear. `presentStatus` is the single source, so a
 *            status cannot look like one thing in the list and another here.
 *   hue    — phase. Warm while the order still owes someone a call, cool once
 *            it is with the carrier, red for an unsuccessful ending.
 *   actor  — who did it. `order_history.actor_type` was on every row all along
 *            and the panel dropped it; "Confirmée" with no author is the most
 *            asked question about a disputed order.
 *   gap    — how long the order sat between this step and the one before it.
 *            Two absolute timestamps make you do that subtraction by hand on
 *            every pair, and the gap is the reason anyone opens this tab.
 *
 * The timestamp sits under its entry rather than right-aligned beside it —
 * an Arabic transition label and a French timestamp on one baseline produced
 * a different gap on every row, so nothing lined up to scan down.
 *
 * Labels are chosen by `historyLocale`, not by `useTranslations`: a Libya order
 * renders Arabic inside an otherwise French console, so the row's own language
 * decides, exactly as the empty state and the status labels already do.
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
    return <div className="py-1 text-[12px] text-oms-ink-3">{emptyText}</div>;
  }

  return (
    <ol
      role="list"
      aria-label={label("label")}
      className="m-0 flex list-none flex-col p-0"
      lang={isAr ? "ar" : undefined}
      dir={isAr ? "rtl" : undefined}
    >
      {entries.map((entry, i) => {
        const isLatest = i === 0;
        const isLast = i === entries.length - 1;
        const face = presentStatus(entry.to_status);
        const note = formatOrderHistoryNote(entry.note, historyLocale);
        // Entries are newest-first, so the step *before* this one is the next
        // element down — the gap belongs to the row that ended the wait.
        const previous = entries[i + 1];
        const gap = previous
          ? formatGap(previous.created_at, entry.created_at, gapLabel)
          : null;

        return (
          <li
            key={entry.id}
            data-current={isLatest ? "true" : undefined}
            className="grid grid-cols-[26px_1fr] gap-x-2.5"
          >
            {/* Rail: the node carries the status mark, the thread joins it to
                the step below. Both are decorative — every reading in them is
                also spelled out in the text column. */}
            <span className="flex flex-col items-center" aria-hidden="true">
              <span
                data-testid="history-icon"
                data-status={entry.to_status}
                data-hue={face.hue}
                className={[
                  "grid h-[26px] w-[26px] flex-none place-items-center rounded-full border",
                  NODE[face.hue],
                  isLatest ? `ring-[3px] ${RING[face.hue]}` : "",
                ].join(" ")}
              >
                <StatusIcon name={face.icon} size={13} />
              </span>
              {!isLast && <span className="my-1 min-h-[14px] w-[1.5px] flex-1 bg-oms-border" />}
            </span>

            <div className="min-w-0 pb-4">
              {/* Transition and actor share a baseline: what happened, then who
                  caused it — the two halves of a single sentence. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[13px] font-semibold text-oms-ink-1">
                  {formatTransition(entry)}
                </span>
                <span
                  data-testid="history-actor"
                  className="rounded-pill bg-oms-sunken px-[7px] py-[1px] text-[10.5px] font-medium text-oms-ink-3"
                >
                  {actorLabel(entry.actor_type, label)}
                </span>
              </div>

              <div className="mt-px flex flex-wrap items-center gap-x-2 text-[11.5px] tabular-nums text-oms-ink-3">
                <span>
                  {new Date(entry.created_at).toLocaleString(isAr ? "ar-LY" : "fr-TN", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {gap && (
                  <span data-testid="history-gap" className="text-oms-ink-3/85">
                    {gap}
                  </span>
                )}
              </div>

              {note && (
                <div className="mt-1.5 rounded-[8px] bg-oms-sunken px-[9px] py-[7px] text-[12.5px] leading-[1.45] text-oms-ink-2">
                  {note}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The node's fill and face. A tint rather than the solid used by the delivery
 * rail: this list is up to thirty rows tall, and thirty saturated discs down one
 * edge is a decoration, not a signal.
 */
const NODE: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-bg border-hue-neutral-edge-mid text-hue-neutral-ink",
  amber: "bg-hue-amber-bg border-hue-amber-edge-mid text-hue-amber-ink",
  violet: "bg-hue-violet-bg border-hue-violet-edge-mid text-hue-violet-ink",
  teal: "bg-hue-teal-bg border-hue-teal-edge-mid text-hue-teal-ink",
  green: "bg-hue-green-bg border-hue-green-edge-mid text-hue-green-ink",
  red: "bg-hue-red-bg border-hue-red-edge-mid text-hue-red-ink",
};

/** Only the newest entry wears it — where the order stands right now. */
const RING: Record<StatusHue, string> = {
  neutral: "ring-hue-neutral-fill-soft",
  amber: "ring-hue-amber-fill-soft",
  violet: "ring-hue-violet-fill-soft",
  teal: "ring-hue-teal-fill-soft",
  green: "ring-hue-green-fill-soft",
  red: "ring-hue-red-fill-soft",
};

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
