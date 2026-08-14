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
 * Sticky footer: the primary CTA, the second-commonest action beside it, and
 * everything else behind `⋯`.
 *
 * Promoting the second action is what the panel's own design asks for — but
 * only when it is safe to promote. `resolvePanelActions` puts `cancel` first
 * for managers on several statuses, so promoting blindly would park "Annuler
 * la commande" one mis-click from "Confirmer". Destructive actions stay in the
 * menu, where opening it is the confirmation step.
 *
 * Translations live under `orders.detail.actions.*` — every PanelAction kind
 * carries its own labelKey so this footer never knows about state.
 */
/** Outline treatments for the two non-primary call outcomes. */
const OUTCOME_TONE: Record<string, string> = {
  callback: "border-oms-warn text-oms-warn-ink hover:bg-oms-warn-bg",
  reject: "border-oms-bad text-oms-bad hover:bg-oms-bad-bg",
};

export function ActionFooter({ actions, primaryPending, onInvoke }: ActionFooterProps) {
  const t = useTranslations("orders.detail");
  const { primary, overflow, outcomes = [] } = actions;

  const primaryLabelKey = primary.labelKey.replace(/^actions\./, "actions.");
  // useTranslations is already namespaced to "orders.detail" — the leaf is
  // therefore "actions.*". next-intl supports dot-paths via t("a.b").
  const primaryLabel = t(primaryLabelKey as Parameters<typeof t>[0]);

  const disabledTitle = primary.disabled && primary.disabledReasonKey
    ? t(primary.disabledReasonKey as Parameters<typeof t>[0])
    : undefined;

  // With three outcomes already on the bar there is nothing to promote — the
  // footer is full, and a fourth button would only make the three that matter
  // harder to hit.
  const promotedIndex = outcomes.length
    ? -1
    : overflow.findIndex((a) => !a.destructive && !a.disabled);
  const promoted = promotedIndex >= 0 ? overflow[promotedIndex] : null;
  const remaining = overflow.filter((_, i) => i !== promotedIndex);

  const items: MenuItem[] = remaining.map((action) => ({
    id: action.kind,
    label: t(action.labelKey as Parameters<typeof t>[0]),
    onSelect: () => onInvoke(action.kind),
    disabled: action.disabled,
    destructive: action.destructive,
  }));

  return (
    <div className="flex flex-shrink-0 items-center gap-2 border-t border-oms-border bg-oms-surface px-[18px] py-[13px]">
      {promoted ? (
        <button
          type="button"
          onClick={() => onInvoke(promoted.kind)}
          className="inline-flex h-[38px] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border border-oms-border bg-oms-surface text-[13px] font-semibold text-oms-ink-1 transition-colors duration-fast hover:border-oms-border-strong hover:bg-oms-sunken"
        >
          {t(promoted.labelKey as Parameters<typeof t>[0])}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onInvoke(primary.kind)}
        disabled={primary.disabled || primaryPending}
        title={disabledTitle}
        className={[
          "inline-flex h-[38px] flex-1 items-center justify-center whitespace-nowrap rounded-[9px] text-[13px] font-semibold",
          "border border-oms-accent bg-oms-accent text-white transition-colors duration-fast hover:bg-oms-accent-ink hover:border-oms-accent-ink",
          "disabled:cursor-not-allowed disabled:opacity-[0.42]",
        ].join(" ")}
      >
        {primaryLabel}
      </button>

      {outcomes.map((outcome) => (
        <button
          key={outcome.kind}
          type="button"
          onClick={() => onInvoke(outcome.kind)}
          disabled={outcome.disabled || primaryPending}
          className={[
            "inline-flex h-[38px] flex-1 items-center justify-center whitespace-nowrap rounded-[9px] border bg-oms-surface text-[13px] font-semibold transition-colors duration-fast",
            OUTCOME_TONE[outcome.kind] ?? "border-oms-border text-oms-ink-1 hover:bg-oms-sunken",
            "disabled:cursor-not-allowed disabled:opacity-[0.42]",
          ].join(" ")}
        >
          {t(outcome.labelKey as Parameters<typeof t>[0])}
        </button>
      ))}

      {items.length > 0 ? (
        <Menu
          ariaLabel={t("actions.overflowMenu")}
          items={items}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={t("actions.overflowMenu")}
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[9px] border border-oms-border text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
            >
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          }
        />
      ) : null}
    </div>
  );
}
