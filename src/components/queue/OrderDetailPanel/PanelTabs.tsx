"use client";

import { useTranslations } from "next-intl";

/**
 * The panel's three sections as tabs.
 *
 * Four stacked cards meant scrolling past address and fulfilment to reach the
 * log. Tabs only work here because the customer, phone, address and total stay
 * pinned above — an agent mid-call never switches tabs to read something aloud.
 */
export type PanelTab = "items" | "shipping" | "history" | "messages";

interface Props {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
  /** Shown on the history tab so the log's size is visible without opening it. */
  historyCount?: number;
  /**
   * Unread WhatsApp replies. The tab appears only when the market has a
   * business number (undefined hides it); the pill is the unread count.
   */
  messagesCount?: number;
  showMessages?: boolean;
}

export function PanelTabs({ active, onChange, historyCount, messagesCount, showMessages = false }: Props) {
  const t = useTranslations("orders.detail");
  const tabs: { key: PanelTab; label: string; count?: number; accent?: boolean }[] = [
    { key: "items", label: t("tabItems") },
    { key: "shipping", label: t("tabShipping") },
    { key: "history", label: t("tabHistory"), count: historyCount },
    ...(showMessages ? [{ key: "messages" as const, label: t("tabMessages"), count: messagesCount, accent: true }] : []),
  ];

  return (
    <div
      role="tablist"
      className="flex h-[42px] flex-shrink-0 items-stretch gap-[26px] border-b border-oms-border px-[18px] max-lg:gap-5 max-lg:px-3.5"
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
              "relative inline-flex items-center gap-[7px] whitespace-nowrap text-[15px] transition-colors duration-fast " +
              (selected
                ? "font-bold text-brand"
                : "font-semibold text-oms-ink-2 hover:text-oms-ink-1")
            }
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span
                data-testid={tab.accent ? "messages-unread" : undefined}
                className={`grid h-5 min-w-[22px] place-items-center rounded-pill px-1.5 text-[12px] font-semibold tabular-nums ${
                  tab.accent ? "bg-brand text-white" : "bg-oms-sunken text-oms-ink-2"
                }`}
              >
                {tab.count}
              </span>
            )}
            {selected && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-[2px] bg-brand"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
