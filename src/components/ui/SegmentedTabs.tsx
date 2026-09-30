"use client";

import type { LucideIcon } from "lucide-react";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";

/**
 * A row of bordered segments, each carrying a label and a count.
 *
 * §4.11 deprecated pills-as-tabs and reserved the accent for an underline. That
 * rule was written for the orders console, which has one level of navigation.
 * The agent queue has three — bucket, then sub-filter, then attempt number — and
 * an underline can mark one row as current but cannot show that a second row is
 * nested inside the first. Two stacked underlines read as siblings.
 *
 * So levels 1 and 2 are segments, and the accent moves from the underline to the
 * active segment's count badge. See §4.18.
 *
 * `role` matters: level 1 is navigation between peers (`tablist`), level 2
 * narrows what you are already inside (`group`, with `aria-pressed`). Announcing
 * a filter row as a tablist tells a screen-reader user it is something it isn't.
 */

export interface Segment {
  key: string;
  label: string;
  /** Rendered even when zero — a missing badge reads as "no such bucket". */
  count?: number;
  /** Level-1 segments carry their own icon. */
  icon?: LucideIcon;
  /**
   * The status this segment filters for. Drives hue and icon from the shared
   * presentation map, so a chip and the pills it reveals cannot disagree.
   * Null/undefined for a neutral segment such as "all".
   */
  status?: string | null;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
  /** `md` = level 1 (buckets), `sm` = level 2 (sub-filters). */
  size?: "md" | "sm";
  /**
   * How the active segment is marked. "badge" moves the accent to the count
   * (§4.18) and is what the warehouse consoles use. "outline" puts a brand
   * border round the whole segment and tints the count instead — the agent
   * queue's buckets, where the row sits on the page background rather than
   * inside a panel and a bordered segment needs the stronger edge to read as
   * chosen.
   */
  variant?: "badge" | "outline";
  role?: "tablist" | "group";
  ariaLabel: string;
  /** Rendered at the trailing edge of the row (e.g. a refresh control). */
  trailing?: React.ReactNode;
  className?: string;
}

/** Ink for a segment whose hue comes from the status it filters for. */
const HUE_INK: Record<StatusHue, string> = {
  neutral: "text-hue-neutral-edge",
  amber: "text-hue-amber-edge",
  violet: "text-hue-violet-edge",
  teal: "text-hue-teal-edge",
  green: "text-hue-green-edge",
  red: "text-hue-red-edge",
};

export function SegmentedTabs({
  segments,
  value,
  onChange,
  size = "md",
  variant = "badge",
  role = "tablist",
  ariaLabel,
  trailing,
  className = "",
}: Props) {
  const isTabs = role === "tablist";

  return (
    <div
      role={role}
      aria-label={ariaLabel}
      className={[
        "custom-scrollbar flex items-center gap-2 overflow-x-auto",
        variant === "outline" ? "" : "border-b border-agent-outline-variant pb-2",
        className,
      ].join(" ")}
    >
      {segments.map((seg) => {
        const active = seg.key === value;
        const face = seg.status ? presentStatus(seg.status) : null;
        const Icon = seg.icon;

        return (
          <button
            key={seg.key}
            type="button"
            {...(isTabs
              ? { role: "tab", "aria-selected": active }
              : { "aria-pressed": active })}
            onClick={() => onChange(seg.key)}
            className={[
              "inline-flex shrink-0 items-center gap-2 rounded-lg border",
              size === "md"
                ? "h-[38px] px-3 text-[13.5px]"
                : "h-[30px] px-2.5 text-[12.5px]",
              "font-semibold whitespace-nowrap transition-colors duration-fast",
              active
                ? variant === "outline"
                  ? "border-[1.5px] border-brand bg-agent-surface text-brand-deep"
                  : "border-agent-outline bg-agent-surface text-agent-on-surface"
                : "border-agent-outline-variant bg-agent-surface text-agent-on-surface-variant hover:border-agent-outline hover:text-agent-on-surface",
            ].join(" ")}
          >
            {Icon && (
              <Icon
                size={size === "md" ? 17 : 13}
                strokeWidth={active ? 2.25 : 2}
                aria-hidden="true"
                className={[
                  "shrink-0",
                  active ? (variant === "outline" ? "text-brand" : "") : "opacity-60",
                ].join(" ")}
              />
            )}
            {face && (
              <span
                aria-hidden="true"
                className={[
                  "grid w-3.5 flex-none place-items-center",
                  active ? "" : `${HUE_INK[face.hue]} opacity-70`,
                ].join(" ")}
              >
                <StatusIcon name={face.icon} size={13} />
              </span>
            )}

            <span className="truncate">{seg.label}</span>

            {seg.count !== undefined && (
              <span
                className={[
                  "grid h-5 min-w-[21px] shrink-0 place-items-center rounded-pill px-1.5",
                  "text-[11px] font-bold tabular-nums transition-colors duration-fast",
                  // The one place the accent appears in this component (§4.18).
                  active
                    ? variant === "outline"
                      ? "bg-hue-green-fill-soft text-brand"
                      : "bg-brand text-white"
                    : "bg-agent-surface-low text-agent-ink-3",
                ].join(" ")}
              >
                {seg.count}
              </span>
            )}
          </button>
        );
      })}

      {trailing && <span className="ms-auto flex shrink-0 items-center">{trailing}</span>}
    </div>
  );
}
