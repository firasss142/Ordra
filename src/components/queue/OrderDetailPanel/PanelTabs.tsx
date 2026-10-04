"use client";

import { useTranslations } from "next-intl";

/**
 * The panel's panes as tabs, on a soft track (prototypes/commandes-v4.html
 * `.tabwrap` / `.tabs`). The strip sticks to the top of the panel's scroll, so
 * switching pane never needs scrolling back up; on a phone it scrolls sideways
 * rather than clipping its last tab.
 */
export type PanelTab = "items" | "shipping" | "history" | "messages";

interface Props {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
  /** Unread WhatsApp replies, on the Messages tab. */
  messagesCount?: number;
  /** The Messages tab appears once the market's WhatsApp state is known. */
  showMessages?: boolean;
}

export function PanelTabs({ active, onChange, messagesCount, showMessages = false }: Props) {
  const t = useTranslations("orders.detail");
  const tabs: { key: PanelTab; label: string; count?: number }[] = [
    { key: "items", label: t("tabItems") },
    { key: "shipping", label: t("tabShipping") },
    { key: "history", label: t("tabHistory") },
    ...(showMessages ? [{ key: "messages" as const, label: t("tabMessages"), count: messagesCount }] : []),
  ];

  return (
    <div className="tabwrap">
      <div className="tabs" role="tablist">
        {tabs.map((tab) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={on}
              className={on ? "on" : undefined}
              onClick={() => onChange(tab.key)}
            >
              {tab.label}
              {typeof tab.count === "number" && tab.count > 0 && <em data-testid="messages-unread">{tab.count}</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
