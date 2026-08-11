"use client";

import { CalendarClock, CalendarDays, CalendarRange, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PeriodPreset } from "@/components/dashboard/FilterBar";

const ICONS: Record<PeriodPreset, LucideIcon> = {
  today: CalendarClock,
  week: CalendarRange,
  month: CalendarDays,
  custom: SlidersHorizontal,
};

const ORDER: PeriodPreset[] = ["today", "week", "month", "custom"];

/**
 * The period control.
 *
 * Replaces the full-width white `FilterBar`, which was a shape no other
 * console page has. Rendered as `tablist`/`tab` rather than a button group:
 * these are peers selecting which slice of time the whole page reports on,
 * which is what a tab is.
 *
 * No `/opacity` modifiers anywhere below — `border-fin-green/40` compiles to
 * nothing on a var()-backed colour in Tailwind v3, which is how the orders
 * console once shipped a status column with no borders at all.
 */
export function FinancePeriodTabs({
  value,
  onChange,
  labels,
  ariaLabel,
}: {
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  labels: Record<PeriodPreset, string>;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-2.5">
      {ORDER.map((preset) => {
        const Icon = ICONS[preset];
        const active = value === preset;
        return (
          <button
            key={preset}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(preset)}
            className={
              "inline-flex h-[42px] items-center gap-2 rounded-fin-sm border bg-white px-4 " +
              "text-[13.5px] font-medium transition-colors duration-fast " +
              (active
                ? "border-fin-green text-fin-green-ink"
                : "border-fin-line text-fin-ink-2 hover:border-fin-green hover:text-fin-navy")
            }
          >
            <Icon
              aria-hidden
              size={16}
              strokeWidth={2}
              className={active ? "text-fin-green" : "text-fin-ink-3"}
            />
            {labels[preset]}
          </button>
        );
      })}
    </div>
  );
}
