"use client";

import { useTranslations } from "next-intl";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Ic } from "@/components/orders/commandes/ui";
import type { PanelAction, PanelActionKind, PanelActions } from "./types";

export interface ActionFooterProps {
  actions: PanelActions;
  /** Loading state on the bar (e.g. while a reopen is in flight). */
  primaryPending?: boolean;
  /** Maps each overflow + primary kind to its host-component handler. */
  onInvoke: (kind: PanelActionKind) => void;
  /**
   * Print the list's keyboard hint under the buttons. True only in the agent
   * queue, which is the one surface where ↑↓ and Enter do anything.
   */
  showNavHint?: boolean;
  /** Add « F voix du client » to that hint line (plans/voix-du-client.md). */
  feedbackHint?: boolean;
}

/**
 * The footer per status (prototypes/commandes-v4.html `footHTML`, `.dr-foot`):
 *
 *   calling            Pas de réponse · Confirmer (filled) · Refuser (red) · Rappeler · ⋯
 *   confirmed          Envoyer au transporteur (filled, wide) · Planifier la livraison · ⋯
 *   dispatch_scheduled Envoyer maintenant (filled, wide) · Annuler la planification · ⋯
 *   deleted            Restaurer la commande (filled, wide)
 *   otherwise          Fermer (wide) · ⋯
 *
 * Which actions exist is decided by `resolvePanelActions` (usePrimaryAction.ts);
 * this only draws them. Outside the call, the first safe overflow item is
 * promoted beside the primary; anything destructive stays behind ⋯.
 */

/** Fixed slot order for the call's four endings. */
const FOOTER_ORDER: PanelActionKind[] = ["endCall", "confirm", "reject", "callback"];

/** The prototype's glyphs; the endings other than Confirmer carry none. */
const ACTION_ICON: Partial<Record<PanelActionKind, string>> = {
  confirm: "check",
  uploadToCarrier: "truck",
  uploadNow: "truck",
  scheduleDispatch: "cal",
  reopen: "rotate",
  recover: "rotate",
};

export function ActionFooter({
  actions,
  primaryPending,
  onInvoke,
  showNavHint = false,
  feedbackHint = false,
}: ActionFooterProps) {
  const t = useTranslations("orders.detail");
  const tFeedback = useTranslations("feedback.capture");
  const { primary, overflow, outcomes = [] } = actions;

  const disabledTitle =
    primary.disabled && primary.disabledReasonKey
      ? t(primary.disabledReasonKey as Parameters<typeof t>[0])
      : undefined;

  // With the call's endings on the bar there is nothing to promote.
  const promotedIndex = outcomes.length ? -1 : overflow.findIndex((a) => !a.destructive && !a.disabled);
  const promoted = promotedIndex >= 0 ? overflow[promotedIndex] : null;
  const remaining = overflow.filter((_, i) => i !== promotedIndex);

  const slot = (a: PanelAction) => {
    const i = FOOTER_ORDER.indexOf(a.kind);
    return i === -1 ? FOOTER_ORDER.length : i;
  };
  const bar: PanelAction[] = [primary, ...outcomes, ...(promoted ? [promoted] : [])].sort((a, b) => slot(a) - slot(b));

  const items: MenuItem[] = remaining.map((action) => ({
    id: action.kind,
    label: t(action.labelKey as Parameters<typeof t>[0]),
    onSelect: () => onInvoke(action.kind),
    disabled: action.disabled,
    destructive: action.destructive,
  }));

  const single = outcomes.length === 0;

  return (
    <>
      <div className="dr-foot" data-testid="panel-actions">
        {bar.map((action) => {
          const isPrimary = action === primary;
          const icon = ACTION_ICON[action.kind];
          const cls = [
            "fa",
            isPrimary && action.kind !== "close" ? "pri" : "",
            isPrimary && single ? "wide" : "",
            action.kind === "reject" ? "neg" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={action.kind}
              type="button"
              data-kind={action.kind}
              className={cls}
              onClick={() => onInvoke(action.kind)}
              disabled={action.disabled || primaryPending}
              title={isPrimary ? disabledTitle : undefined}
            >
              {icon && <Ic n={icon} />}
              <span>{t(action.labelKey as Parameters<typeof t>[0])}</span>
            </button>
          );
        })}

        {items.length > 0 ? (
          <Menu
            ariaLabel={t("actions.overflowMenu")}
            items={items}
            align="end"
            trigger={
              <button type="button" className="fa io" aria-label={t("actions.overflowMenu")}>
                <Ic n="more" />
              </button>
            }
          />
        ) : null}
      </div>

      {/* Only where the keys do something: the queue's list shortcuts. */}
      {showNavHint ? (
        <p className="odp-hint">
          <kbd>↕</kbd> {t("navHintNav")}
          <span aria-hidden="true"> · </span>
          <kbd>{t("navHintEnterKey")}</kbd> {t("navHintCall")}
          {feedbackHint ? (
            <>
              <span aria-hidden="true"> · </span>
              <b>
                <kbd>F</kbd> {tFeedback("hint")}
              </b>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
