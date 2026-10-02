"use client";

import { useTranslations } from "next-intl";
import {
  Ban,
  CalendarClock,
  Check,
  MoreHorizontal,
  PhoneOff,
  RotateCcw,
  Send,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import type { PanelAction, PanelActionKind, PanelActions } from "./types";

export interface ActionFooterProps {
  actions: PanelActions;
  /** Loading state on the primary CTA (e.g. while upload is in flight). */
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
 * The bar that ends a call.
 *
 * Four peer buttons, always in the same four places, distinguished by a glyph
 * and a tone rather than by size: the agent is reading them under call
 * pressure, and a footer that re-ranks itself per order makes them read it
 * every time. One filled green button says which ending the queue is hoping
 * for; the other three are outlines.
 *
 * Everything that is not an ending — cancel, return to pool, reschedule —
 * stays behind `⋯`, where opening the menu is the confirmation step.
 *
 * Translations live under `orders.detail.actions.*` — every PanelAction kind
 * carries its own labelKey so this footer never knows about state.
 */

/**
 * Fixed slot order, so the button under the agent's thumb is the same button
 * on every order. Anything not listed (an upload, a reopen, a promoted
 * overflow item) keeps the order the resolver gave it, after these.
 */
const FOOTER_ORDER: PanelActionKind[] = ["endCall", "confirm", "reject", "callback"];

const BRAND_FILL =
  "border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover";
const NEUTRAL =
  "border-oms-border-strong bg-oms-surface text-oms-ink-1 hover:bg-oms-sunken";

/** Outline treatments for the two call outcomes that carry a warning. */
const OUTCOME_TONE: Partial<Record<PanelActionKind, string>> = {
  reject: "border-oms-bad/55 bg-oms-surface text-oms-bad hover:bg-oms-bad-bg",
  callback: "border-oms-warn bg-oms-warn-bg text-oms-warn-ink hover:bg-oms-warn/20",
};

/**
 * A glyph per outcome. Four buttons the same height, in the same place, on
 * every order: at a glance they differ only by their words, and the agent is
 * reading four of them under call pressure. The glyph is what tells them apart
 * before the word is read — it is the whole reason the buttons carry no
 * sub-line.
 */
const ACTION_ICON: Partial<Record<PanelActionKind, LucideIcon>> = {
  confirm: Check,
  callback: CalendarClock,
  reject: X,
  endCall: PhoneOff,
  uploadToCarrier: Send,
  uploadNow: Send,
  cancel: Ban,
  returnToPool: Undo2,
  reopen: RotateCcw,
  recover: RotateCcw,
};

/**
 * Column counts as literal strings: Tailwind reads the source, so a template
 * built at runtime would compile to nothing. Below `lg` the bar is always a
 * 2×2 grid — a phone has no room for four labels side by side.
 */
const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:[grid-template-columns:repeat(4,auto)]",
  5: "lg:[grid-template-columns:repeat(4,auto)_44px]",
};

function ActionGlyph({ kind }: { kind: PanelActionKind }) {
  const Icon = ACTION_ICON[kind];
  if (!Icon) return null;
  return <Icon size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />;
}

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

  const primaryLabelKey = primary.labelKey.replace(/^actions\./, "actions.");
  // useTranslations is already namespaced to "orders.detail" — the leaf is
  // therefore "actions.*". next-intl supports dot-paths via t("a.b").
  const primaryLabel = t(primaryLabelKey as Parameters<typeof t>[0]);

  const disabledTitle = primary.disabled && primary.disabledReasonKey
    ? t(primary.disabledReasonKey as Parameters<typeof t>[0])
    : undefined;

  // With the call's endings already on the bar there is nothing to promote —
  // the footer is full, and a fifth button would only make the four that
  // matter harder to hit.
  const promotedIndex = outcomes.length
    ? -1
    : overflow.findIndex((a) => !a.destructive && !a.disabled);
  const promoted = promotedIndex >= 0 ? overflow[promotedIndex] : null;
  const remaining = overflow.filter((_, i) => i !== promotedIndex);

  const slot = (a: PanelAction) => {
    const i = FOOTER_ORDER.indexOf(a.kind);
    return i === -1 ? FOOTER_ORDER.length : i;
  };
  const bar: PanelAction[] = [primary, ...outcomes, ...(promoted ? [promoted] : [])].sort(
    (a, b) => slot(a) - slot(b),
  );

  const items: MenuItem[] = remaining.map((action) => ({
    id: action.kind,
    label: t(action.labelKey as Parameters<typeof t>[0]),
    onSelect: () => onInvoke(action.kind),
    disabled: action.disabled,
    destructive: action.destructive,
  }));

  const cells = Math.min(bar.length + (items.length > 0 ? 1 : 0), 5);

  return (
    // Phone: clear the home indicator where the browser reports one, and
    // never sit flush on the bottom edge where it does not.
    <div className="flex-shrink-0 border-t border-oms-border bg-oms-surface px-3 pb-2 pt-2.5 max-lg:pb-[max(14px,env(safe-area-inset-bottom))]">
      <div
        data-testid="panel-actions"
        className={[
          "grid gap-1.5",
          cells === 1 ? "grid-cols-1" : "grid-cols-2",
          LG_COLUMNS[cells] ?? LG_COLUMNS[4],
        ].join(" ")}
      >
        {bar.map((action) => {
          const isPrimary = action === primary;
          const label =
            isPrimary ? primaryLabel : t(action.labelKey as Parameters<typeof t>[0]);
          return (
            <button
              key={action.kind}
              type="button"
              data-kind={action.kind}
              onClick={() => onInvoke(action.kind)}
              disabled={action.disabled || primaryPending}
              title={isPrimary ? disabledTitle : undefined}
              className={[
                "flex h-[46px] min-w-0 items-center justify-center gap-[7px] rounded-[10px] border px-2.5",
                "text-[13px] font-bold transition-colors duration-fast",
                OUTCOME_TONE[action.kind] ?? (isPrimary ? BRAND_FILL : NEUTRAL),
                "disabled:cursor-not-allowed disabled:opacity-[0.42]",
              ].join(" ")}
            >
              <ActionGlyph kind={action.kind} />
              <span className="truncate">{label}</span>
            </button>
          );
        })}

        {items.length > 0 ? (
          <Menu
            ariaLabel={t("actions.overflowMenu")}
            items={items}
            align="end"
            trigger={
              <button
                type="button"
                aria-label={t("actions.overflowMenu")}
                className="flex h-[46px] w-full items-center justify-center rounded-[10px] border border-oms-border-strong text-oms-ink-2 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1 lg:w-11"
              >
                <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            }
          />
        ) : null}
      </div>

      {/* Only where the keys do something: the queue's list shortcuts — and
          never on a phone, which has neither arrows nor Enter. */}
      {showNavHint ? (
        <p className="m-0 mt-2.5 text-center text-[12px] text-oms-ink-3 max-lg:hidden">
          <Kbd>↕</Kbd> {t("navHintNav")}
          <span aria-hidden="true"> · </span>
          <Kbd>{t("navHintEnterKey")}</Kbd> {t("navHintCall")}
          {feedbackHint ? (
            <>
              <span aria-hidden="true"> · </span>
              <b className="font-semibold text-[#6D28D9]">
                <Kbd>F</Kbd> {tFeedback("hint")}
              </b>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-oms-border-strong bg-oms-sunken px-1 font-[inherit] text-[11px] font-bold text-oms-ink-2 align-[-1px]">
      {children}
    </kbd>
  );
}
