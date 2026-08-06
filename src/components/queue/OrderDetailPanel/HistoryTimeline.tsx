"use client";

import { useTranslations } from "next-intl";
import { getStatusLabel } from "@/lib/status-labels";
import { formatOrderHistoryNote } from "@/lib/order-history-display";
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
 * The timestamp sits under its entry rather than right-aligned beside it —
 * an Arabic transition label and a French timestamp on one baseline produced
 * a different gap on every row, so nothing lined up to scan down.
 */
export function HistoryTimeline({ entries, historyLocale }: HistoryTimelineProps) {
  const t = useTranslations("orders.detail");
  const th = useTranslations("orders.history");

  const emptyText = historyLocale === "ar" ? "لا يوجد سجل" : t("emptyHistory");

  function formatTransition(entry: HistoryEntry): string {
    const to = getStatusLabel(entry.to_status, historyLocale);
    if (!entry.from_status) return to;
    const from = getStatusLabel(entry.from_status, historyLocale);
    return historyLocale === "ar" ? `${from} ← ${to}` : th("transition", { from, to });
  }

  if (entries.length === 0) {
    return <div className="py-1 text-[12px] text-oms-ink-3">{emptyText}</div>;
  }

  return (
    <ol
      className="m-0 flex list-none flex-col p-0"
      lang={historyLocale === "ar" ? "ar" : undefined}
      dir={historyLocale === "ar" ? "rtl" : undefined}
    >
      {entries.map((entry, i) => {
        const isLatest = i === 0;
        const isLast = i === entries.length - 1;
        return (
          <li key={entry.id} className="grid grid-cols-[16px_1fr] gap-[11px]">
            <span className="flex flex-col items-center" aria-hidden="true">
              <span
                className={[
                  "mt-[5px] h-[9px] w-[9px] flex-none rounded-full",
                  isLatest
                    ? "bg-oms-accent ring-[3px] ring-oms-accent-bg"
                    : "bg-oms-border-strong",
                ].join(" ")}
              />
              {!isLast && <span className="my-1 min-h-[16px] w-[1.5px] flex-1 bg-oms-border" />}
            </span>
            <div className="min-w-0 pb-4">
              <div className="text-[13px] font-semibold text-oms-ink-1">
                {formatTransition(entry)}
              </div>
              <div className="mt-px text-[11.5px] tabular-nums text-oms-ink-3">
                {new Date(entry.created_at).toLocaleString(
                  historyLocale === "ar" ? "ar-LY" : "fr-TN",
                  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                )}
              </div>
              {entry.note && (
                <div className="mt-1.5 rounded-[8px] bg-oms-sunken px-[9px] py-[7px] text-[12.5px] leading-[1.45] text-oms-ink-2">
                  {formatOrderHistoryNote(entry.note, historyLocale)}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
