"use client";

import { useTranslations, useLocale } from "next-intl";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { STATUS_HUE_TONE, STATUS_WEIGHT_FONT } from "@/components/shared/status-tone";
import { presentAgentStatus } from "@/lib/queue/agent-status";
import type { StatusHue } from "@/lib/orders/status-presentation";
import { formatTime } from "@/lib/format";
import type { QueueOrder } from "@/types/queue";

/**
 * One order status in the agent queue: a glyph, the state in words, and — when
 * there is one — a number worth comparing down the column.
 *
 * Geometry is fixed on purpose. The glyph sits in an 8px slot so every label in
 * the column starts at the same x, and the datum sits in a tinted well at the
 * end, so the shape of a pill is the same whatever it says. A column of these
 * scans; a column of free-width pills zigzags.
 *
 * Hue, glyph and weight all come from `lib/queue/agent-status`, which defers to
 * the shared `lib/orders/status-presentation` map — this component chooses no
 * colours of its own.
 */

interface Props {
  order: QueueOrder;
  /** The market's `max_call_attempts`; omit until settings load. */
  maxAttempts?: number | null;
  /** Injected so "overdue" is deterministic in tests. */
  now?: Date;
  className?: string;
}

/**
 * The datum well, tinted per hue rather than derived from the text colour.
 *
 * Reuses the pill's own `-edge-soft` step rather than a `/20` modifier, which
 * Tailwind drops on a var()-backed colour — see `components/shared/status-tone`.
 */
const WELL: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-edge-soft",
  amber: "bg-hue-amber-edge-soft",
  violet: "bg-hue-violet-edge-soft",
  teal: "bg-hue-teal-edge-soft",
  green: "bg-hue-green-edge-soft",
  red: "bg-hue-red-edge-soft",
};

export function QueueStatusPill({ order, maxAttempts = null, now, className = "" }: Props) {
  const tStatuses = useTranslations("orders.statuses");
  const tDetail = useTranslations("orders.detail");
  const tSubShort = useTranslations("orders.rejectionSubreasonsShort");
  const tReasons = useTranslations("orders.rejectionReasons");
  const tQueue = useTranslations("queue");
  const locale = useLocale();

  const { hue, weight, icon, label, datum } = presentAgentStatus(order, {
    maxAttempts,
    nowMs: now?.getTime(),
  });

  const rawLabel =
    label.ns === "literal"
      ? label.text
      : label.ns === "orders.detail"
        ? tDetail(label.key as Parameters<typeof tDetail>[0])
        : label.ns === "orders.rejectionSubreasonsShort"
          ? tSubShort(label.key as Parameters<typeof tSubShort>[0])
          : label.ns === "orders.rejectionReasons"
            ? tReasons(label.key as Parameters<typeof tReasons>[0])
            : tStatuses(label.key as Parameters<typeof tStatuses>[0]);

  const datumText =
    datum === null
      ? null
      : datum.kind === "counter"
        ? datum.value
        : datum.kind === "overdue"
          ? tQueue("overdueShort")
          : formatTime(datum.at, locale);

  // "Tentative 3" beside a "5/8" counter renders as "Tentative 35/8", which
  // reads as thirty-five eighths. The counter is a better version of that
  // trailing number, so it replaces it. Matches "Tentative 3" and "محاولة 3".
  const text =
    datum?.kind === "counter" ? rawLabel.replace(/[\s ]*\d+$/, "") : rawLabel;

  const tone = STATUS_HUE_TONE[hue];

  return (
    <span
      data-testid="queue-status"
      data-hue={hue}
      data-weight={weight}
      // One phrase, so a screen reader says "Tentative 1/8" rather than two
      // disconnected fragments.
      aria-label={datumText ? `${text} ${datumText}` : rawLabel}
      className={[
        "inline-flex h-[24px] max-w-full items-center gap-1.5 whitespace-nowrap",
        "rounded-pill border px-2 text-[12.5px] leading-none",
        tone.ink,
        tone[weight],
        STATUS_WEIGHT_FONT[weight],
        className,
      ].join(" ")}
    >
      {/* Fixed-width slot: every label in the column starts at the same x, so
          the eye has something to run down. */}
      <span aria-hidden="true" className="grid w-3.5 flex-none place-items-center">
        <StatusIcon name={icon} size={14} />
      </span>
      <span className="truncate">{text}</span>
      {datumText && (
        <span
          aria-hidden="true"
          className={[
            "flex-none rounded-pill px-1.5 py-[2px] text-[11px] font-bold tabular-nums",
            // An explicit per-hue tint. This used to be `bg-current/[0.13]`,
            // which takes the *text* colour at 13% over an already-tinted pill
            // and muddies differently in every hue.
            WELL[hue],
          ].join(" ")}
        >
          {datumText}
        </span>
      )}
    </span>
  );
}
