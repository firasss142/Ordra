"use client";

import { StatusGlyph } from "@/components/shared/StatusGlyph";
import {
  presentStatus,
  type StatusHue,
  type StatusWeight,
} from "@/lib/orders/status-presentation";

export interface OrderStatusBadgeProps {
  status: string;
  /** Already localised — this component does no lookup. */
  label: string;
  locale?: string;
  /** Truth for calls made; the status label stops counting at three. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`. Omit until settings load. */
  maxAttempts?: number | null;
  className?: string;
}

/**
 * One order status: a glyph, the label in words, and — on attempts — how much
 * runway is left.
 *
 * Colour alone used to carry the whole signal, and it carried it backwards:
 * `uploaded` (35% of rows) and `rejected` (28%) shouted in blue and red while
 * `pending` sat in a grey outline that read as disabled. Now hue says which
 * phase and outcome, the glyph says open or closed, and only `weight` decides
 * how loud any of it gets.
 */

// Every state keeps a pill — the hue is how you recognise it. What changes
// with weight is how much the pill asserts itself: a lighter wash and a
// lighter face when nothing is owed, the full tint when someone has to act,
// and a border only when the order is actually in trouble. A border is the
// one treatment that reads as an alarm, so it is spent last.
const HUE: Record<StatusHue, { ink: string; quiet: string; medium: string; loud: string }> = {
  neutral: {
    ink: "text-oms-ink-2",
    quiet: "bg-oms-sunken",
    medium: "bg-oms-sunken",
    loud: "bg-oms-sunken border-oms-border-strong",
  },
  amber: {
    ink: "text-oms-warn-ink",
    quiet: "bg-oms-warn-bg/70",
    medium: "bg-oms-warn-bg",
    loud: "bg-oms-warn-bg border-oms-warn/45",
  },
  violet: {
    ink: "text-oms-accent-ink",
    quiet: "bg-oms-accent-bg/70",
    medium: "bg-oms-accent-bg",
    loud: "bg-oms-accent-bg border-oms-accent/45",
  },
  teal: {
    ink: "text-oms-info-ink",
    quiet: "bg-oms-info-bg/70",
    medium: "bg-oms-info-bg",
    loud: "bg-oms-info-bg border-oms-info/45",
  },
  green: {
    ink: "text-oms-ok",
    quiet: "bg-oms-ok-bg/70",
    medium: "bg-oms-ok-bg",
    loud: "bg-oms-ok-bg border-oms-ok/45",
  },
  red: {
    ink: "text-oms-bad",
    quiet: "bg-oms-bad-bg/70",
    medium: "bg-oms-bad-bg",
    loud: "bg-oms-bad-bg border-oms-bad/45",
  },
};

const FONT: Record<StatusWeight, string> = {
  quiet: "font-medium",
  medium: "font-semibold",
  loud: "font-[650]",
};

export function OrderStatusBadge({
  status,
  label,
  attemptsCount,
  maxAttempts,
  className = "",
}: OrderStatusBadgeProps) {
  const { hue, weight, glyph, counter } = presentStatus(status, {
    attemptsCount,
    maxAttempts,
  });
  const tone = HUE[hue];

  // "Tentative 1" plus a "1/8" counter renders as "Tentative 11/8", which
  // reads as eleven-eighths. The counter is a better version of that trailing
  // number, so it replaces it rather than following it. Matching on a trailing
  // digit works for "Tentative 1" and "محاولة 1" alike.
  const text = counter ? label.replace(/[\s ]*\d+$/, "") : label;

  return (
    <span
      data-testid="order-status"
      data-weight={weight}
      data-hue={hue}
      // One accessible phrase — a screen reader should hear "Tentative 2, 2/8",
      // not two disconnected fragments.
      aria-label={counter ? `${text} ${counter}` : label}
      className={[
        // The glyph sits in a fixed 8px slot so every label in the column
        // starts at the same x. Pills used to run 48px to 82px wide, so the
        // eye zigzagged down a thousand rows with nothing to anchor on.
        "inline-flex h-5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill border border-transparent px-2 text-[11.5px] leading-none",
        tone.ink,
        tone[weight],
        FONT[weight],
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className="grid w-2 flex-none place-items-center">
        <StatusGlyph shape={glyph} tone="default" />
      </span>
      <span className="truncate">{text}</span>
      {counter && (
        <span
          data-testid="status-counter"
          aria-hidden="true"
          className="flex-none tabular-nums opacity-75"
        >
          {counter}
        </span>
      )}
    </span>
  );
}
