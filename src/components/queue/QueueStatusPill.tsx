"use client";

import { useTranslations, useLocale } from "next-intl";
import { StatusGlyph } from "@/components/shared/StatusGlyph";
import { presentAgentStatus } from "@/lib/queue/agent-status";
import type { StatusHue, StatusWeight } from "@/lib/orders/status-presentation";
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

const HUE: Record<StatusHue, { ink: string; quiet: string; medium: string; loud: string }> = {
  neutral: {
    ink: "text-hue-neutral-ink",
    quiet: "bg-hue-neutral-bg/70",
    medium: "bg-hue-neutral-bg",
    loud: "bg-hue-neutral-bg border-hue-neutral-edge/45",
  },
  amber: {
    ink: "text-hue-amber-ink",
    quiet: "bg-hue-amber-bg/70",
    medium: "bg-hue-amber-bg",
    loud: "bg-hue-amber-bg border-hue-amber-edge/45",
  },
  violet: {
    ink: "text-hue-violet-ink",
    quiet: "bg-hue-violet-bg/70",
    medium: "bg-hue-violet-bg",
    loud: "bg-hue-violet-bg border-hue-violet-edge/45",
  },
  teal: {
    ink: "text-hue-teal-ink",
    quiet: "bg-hue-teal-bg/70",
    medium: "bg-hue-teal-bg",
    loud: "bg-hue-teal-bg border-hue-teal-edge/45",
  },
  green: {
    ink: "text-hue-green-ink",
    quiet: "bg-hue-green-bg/70",
    medium: "bg-hue-green-bg",
    loud: "bg-hue-green-bg border-hue-green-edge/45",
  },
  red: {
    ink: "text-hue-red-ink",
    quiet: "bg-hue-red-bg/70",
    medium: "bg-hue-red-bg",
    loud: "bg-hue-red-bg border-hue-red-edge/45",
  },
};

const FONT: Record<StatusWeight, string> = {
  quiet: "font-medium",
  medium: "font-semibold",
  loud: "font-[650]",
};

export function QueueStatusPill({ order, maxAttempts = null, now, className = "" }: Props) {
  const tStatuses = useTranslations("orders.statuses");
  const tDetail = useTranslations("orders.detail");
  const tQueue = useTranslations("queue");
  const locale = useLocale();

  const { hue, weight, glyph, label, datum } = presentAgentStatus(order, {
    maxAttempts,
    nowMs: now?.getTime(),
  });

  const rawLabel =
    label.ns === "orders.detail"
      ? tDetail(label.key as Parameters<typeof tDetail>[0])
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

  const tone = HUE[hue];

  return (
    <span
      data-testid="queue-status"
      data-hue={hue}
      data-weight={weight}
      // One phrase, so a screen reader says "Tentative 1/8" rather than two
      // disconnected fragments.
      aria-label={datumText ? `${text} ${datumText}` : rawLabel}
      className={[
        "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap",
        "rounded-pill border border-transparent px-2 text-[11.5px] leading-none",
        tone.ink,
        tone[weight],
        FONT[weight],
        className,
      ].join(" ")}
    >
      <span aria-hidden="true" className="grid w-2 flex-none place-items-center">
        <StatusGlyph shape={glyph} tone="inherit" />
      </span>
      <span className="truncate">{text}</span>
      {datumText && (
        <span
          aria-hidden="true"
          className="flex-none rounded-pill bg-current/[0.13] px-1.5 py-[2px] text-[10.5px] font-bold tabular-nums"
        >
          {datumText}
        </span>
      )}
    </span>
  );
}
