"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { getStatusLabel } from "@/lib/status-labels";
import { formatOrderHistoryNote } from "@/lib/order-history-display";
import { SectionCard } from "./SectionCard";
import type { HistoryEntry } from "./types";

export interface HistoryTimelineProps {
  entries: HistoryEntry[];
  /** "ar" forces Arabic locale formatting (Libya orders) regardless of UI locale. */
  historyLocale: "ar" | "fr";
  /** Default-open on terminal statuses where the narrative is the main info. */
  defaultOpen?: boolean;
}

/**
 * Vertical timeline of order status transitions. Collapsed by default
 * elsewhere; the parent passes defaultOpen=true for terminal states.
 * Renders inside a SectionCard so it shares the section grammar with the
 * customer / order / fulfillment cards.
 */
export function HistoryTimeline({
  entries,
  historyLocale,
  defaultOpen = false,
}: HistoryTimelineProps) {
  const t = useTranslations("orders.detail");
  const th = useTranslations("orders.history");
  const [open, setOpen] = useState(defaultOpen);

  const title = historyLocale === "ar" ? "السجل" : t("history");
  const emptyText = historyLocale === "ar" ? "لا يوجد سجل" : t("emptyHistory");

  function formatTransition(entry: HistoryEntry): string {
    const to = getStatusLabel(entry.to_status, historyLocale);
    if (!entry.from_status) return to;
    const from = getStatusLabel(entry.from_status, historyLocale);
    return historyLocale === "ar" ? `${from} ← ${to}` : th("transition", { from, to });
  }

  return (
    <SectionCard
      title={title}
      icon={Clock}
      collapsible={{
        open,
        onToggle: () => setOpen((v) => !v),
        testId: "order-history-toggle",
      }}
      trailing={
        <span className="rounded-pill bg-surface-page px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-secondary">
          {entries.length}
        </span>
      }
    >
      {open && (
        <div
          lang={historyLocale === "ar" ? "ar" : undefined}
          dir={historyLocale === "ar" ? "rtl" : undefined}
        >
          {entries.length === 0 ? (
            <div className="text-[12px] text-ink-muted py-1">{emptyText}</div>
          ) : (
            <ol className="relative flex flex-col gap-0 pt-1">
              <span
                aria-hidden="true"
                className="absolute top-2 bottom-2 w-px bg-line-subtle"
                style={{ insetInlineStart: 3 }}
              />
              {entries.map((entry, i) => {
                const isLatest = i === 0;
                return (
                  <li key={entry.id} className="relative flex items-start gap-3 py-2">
                    <span
                      className={[
                        "relative z-[1] mt-[5px] flex-shrink-0 w-[7px] h-[7px] rounded-full",
                        isLatest ? "bg-ink-primary" : "bg-line-strong",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-[13px] text-ink-primary leading-snug min-w-0">
                          {formatTransition(entry)}
                        </div>
                        <span className="flex-shrink-0 text-[11px] text-ink-muted tabular-nums">
                          {new Date(entry.created_at).toLocaleString(
                            historyLocale === "ar" ? "ar-LY" : "fr-TN",
                            { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                          )}
                        </span>
                      </div>
                      {entry.note && (
                        <div className="text-[11px] text-ink-secondary mt-0.5 leading-snug">
                          {formatOrderHistoryNote(entry.note, historyLocale)}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </SectionCard>
  );
}
