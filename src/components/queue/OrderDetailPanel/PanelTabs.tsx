"use client";

import { useTranslations } from "next-intl";

/**
 * The panel's three sections as tabs.
 *
 * Four stacked cards meant scrolling past address and fulfilment to reach the
 * log. Tabs only work here because the customer, phone, address and total stay
 * pinned above — an agent mid-call never switches tabs to read something aloud.
 */
export type PanelTab = "items" | "shipping" | "history";

interface Props {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
  /** Shown on the history tab so the log's size is visible without opening it. */
  historyCount?: number;
}

export function PanelTabs({ active, onChange, historyCount }: Props) {
  const t = useTranslations("orders.detail");
  const tabs: { key: PanelTab; label: string; count?: number }[] = [
    { key: "items", label: t("tabItems") },
    { key: "shipping", label: t("tabShipping") },
    { key: "history", label: t("tabHistory"), count: historyCount },
  ];

  return (
    <div role="tablist" className="flex gap-0.5 border-b border-line-subtle px-3.5">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={
              "relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-2 text-[13px] transition-colors duration-fast " +
              (selected
                ? "font-semibold text-ink-primary"
                : "font-medium text-ink-muted hover:text-ink-primary")
            }
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span className="grid h-4 min-w-[16px] place-items-center rounded-pill bg-surface-selected px-1 text-[10px] font-semibold tabular-nums text-ink-secondary">
                {tab.count}
              </span>
            )}
            {selected && (
              <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-[2px] rounded-pill bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
