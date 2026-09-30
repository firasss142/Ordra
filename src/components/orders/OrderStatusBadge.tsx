"use client";

import { StatusIcon } from "@/components/shared/StatusIcon";
import { STATUS_HUE_TONE, STATUS_WEIGHT_FONT } from "@/components/shared/status-tone";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";

export interface OrderStatusBadgeProps {
  status: string;
  /** Already localised — this component does no lookup. */
  label: string;
  /**
   * Why this order was rejected, already resolved to a hue and a short phrase
   * (see `lib/orders/rejection-presentation` and `useRejectionBadge`).
   *
   * When present on a `rejected` row it *replaces* both the colour and the
   * word: the row is unmistakably a rejection from its cross glyph, so spending
   * the one readable field on the word "Rejeté" said nothing that the icon had
   * not already said. Ignored on any other status.
   */
  rejection?: { hue: StatusHue; text: string } | null;
  locale?: string;
  /** Truth for calls made; the status label stops counting at three. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`. Omit until settings load. */
  maxAttempts?: number | null;
  /**
   * Drop the word on attempt statuses and let the icon plus the counter carry
   * it — "Tentative 3/8" becomes a 60px pill instead of a 112px one.
   *
   * Only for the orders table, where the column is 120px wide, every attempt
   * row repeats the same word, and the number is the whole reason to look. A
   * surface with room (the detail panel) keeps the phrase.
   */
  compact?: boolean;
  className?: string;
}

/**
 * One order status: its mark, the label in words, and — on attempts — how much
 * runway is left.
 *
 * Colour alone used to carry the whole signal, and it carried it backwards:
 * `uploaded` (35% of rows) and `rejected` (28%) shouted in blue and red while
 * `pending` sat in a grey outline that read as disabled. Now hue says which
 * phase and outcome, the icon says which kind of state, and only `weight`
 * decides how loud any of it gets.
 */

export function OrderStatusBadge({
  status,
  label,
  rejection = null,
  attemptsCount,
  maxAttempts,
  compact = false,
  className = "",
}: OrderStatusBadgeProps) {
  const base = presentStatus(status, { attemptsCount, maxAttempts });
  const { weight, icon, counter } = base;

  // Only `rejected` carries a reason. Guarding on the status rather than on the
  // prop keeps a stale payload from recolouring a row that has since moved on.
  const reason = status === "rejected" ? rejection : null;

  const hue = reason?.hue ?? base.hue;
  const tone = STATUS_HUE_TONE[hue];

  // "Tentative 1" plus a "1/8" counter renders as "Tentative 11/8", which
  // reads as eleven-eighths. The counter is a better version of that trailing
  // number, so it replaces it rather than following it. Matching on a trailing
  // digit works for "Tentative 1" and "محاولة 1" alike.
  const text = reason
    ? reason.text
    : counter
      ? label.replace(/[\s ]*\d+$/, "")
      : label;

  // Reachable only on an attempt status, since that is the only kind that has
  // a counter to stand in for the word.
  const countOnly = compact && counter !== null;

  return (
    <span
      data-testid="order-status"
      data-weight={weight}
      data-hue={hue}
      // One accessible phrase — a screen reader should hear "Tentative 2, 2/8",
      // not two disconnected fragments.
      // The column shows "Faux n°"; a screen reader hears the whole sentence,
      // because "Faux n°" on its own never says the order was rejected.
      aria-label={
        reason
          ? `${label} — ${reason.text}`
          : counter
            ? `${text} ${counter}`
            : label
      }
      className={[
        // The icon sits in a fixed 14px slot so every label in the column starts
        // at the same x. Pills used to run 48px to 82px wide, so the eye
        // zigzagged down a thousand rows with nothing to anchor on.
        "inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 text-[12.5px] leading-none",
        tone.ink,
        tone[weight],
        STATUS_WEIGHT_FONT[weight],
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className="grid w-3.5 flex-none place-items-center">
        <StatusIcon name={icon} size={14} />
      </span>
      {!countOnly && <span className="truncate">{text}</span>}
      {counter && (
        <span
          data-testid="status-counter"
          aria-hidden="true"
          // Once the word is gone the count is the label, so it stops being a
          // faded afterthought and takes the pill's full contrast.
          className={
            countOnly
              ? "flex-none font-semibold tabular-nums"
              : "flex-none tabular-nums opacity-75"
          }
        >
          {counter}
        </span>
      )}
    </span>
  );
}
