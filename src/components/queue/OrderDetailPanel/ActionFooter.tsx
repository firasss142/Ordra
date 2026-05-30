"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import type { PanelActionKind, PanelActions } from "./types";

export interface ActionFooterProps {
  actions: PanelActions;
  /** Loading state on the primary CTA (e.g. while upload is in flight). */
  primaryPending?: boolean;
  /** Maps each overflow + primary kind to its host-component handler. */
  onInvoke: (kind: PanelActionKind) => void;
}

/**
 * Sticky footer for the order panel. Renders one state-contextual primary
 * CTA plus an overflow menu for less-frequent actions. Hides the overflow
 * trigger entirely when no overflow items apply (most terminal states).
 *
 * Translations live under `orders.detail.actions.*` — every PanelAction kind
 * carries its own labelKey so this footer never knows about state.
 */
export function ActionFooter({ actions, primaryPending, onInvoke }: ActionFooterProps) {
  const t = useTranslations("orders.detail");
  const { primary, overflow } = actions;

  const primaryLabelKey = primary.labelKey.replace(/^actions\./, "actions.");
  // useTranslations is already namespaced to "orders.detail" — the leaf is
  // therefore "actions.*". next-intl supports dot-paths via t("a.b").
  const primaryLabel = t(primaryLabelKey as Parameters<typeof t>[0]);

  const disabledTitle = primary.disabled && primary.disabledReasonKey
    ? t(primary.disabledReasonKey as Parameters<typeof t>[0])
    : undefined;

  const items: MenuItem[] = overflow.map((action) => ({
    id: action.kind,
    label: t(action.labelKey as Parameters<typeof t>[0]),
    onSelect: () => onInvoke(action.kind),
    disabled: action.disabled,
    destructive: action.destructive,
  }));

  return (
    <div className="flex-shrink-0 bg-surface-card border-t border-line-subtle px-4 py-3 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onInvoke(primary.kind)}
        disabled={primary.disabled || primaryPending}
        title={disabledTitle}
        className={[
          "flex-1 inline-flex items-center justify-center h-11 rounded-card text-[14px] font-semibold",
          "bg-ink-primary text-white hover:bg-[#2A2A2A] transition-colors duration-fast",
          "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
        ].join(" ")}
      >
        {primaryLabel}
      </button>
      {items.length > 0 ? (
        <Menu
          ariaLabel={t("actions.overflowMenu")}
          items={items}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={t("actions.overflowMenu")}
              className="inline-flex items-center justify-center w-11 h-11 rounded-card border border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
            >
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          }
        />
      ) : null}
    </div>
  );
}
