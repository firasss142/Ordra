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
    <div
      role="tablist"
      className="flex flex-shrink-0 gap-0.5 border-b border-oms-border px-3.5 pt-4"
    >
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
              "relative inline-flex items-center gap-1.5 whitespace-nowrap px-[11px] pb-[11px] pt-2 text-[13px] transition-colors duration-fast " +
              (selected
                ? "font-[650] text-oms-ink-1"
                : "font-medium text-oms-ink-3 hover:text-oms-ink-1")
            }
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span className="grid h-4 min-w-[16px] place-items-center rounded-pill bg-oms-sunken px-1 text-[10px] font-[650] tabular-nums text-oms-ink-3">
                {tab.count}
              </span>
            )}
            {selected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-pill bg-oms-accent"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
