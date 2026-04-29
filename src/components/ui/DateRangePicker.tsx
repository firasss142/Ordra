"use client";

import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DayPicker, type DateRange } from "react-day-picker";
import { format, parseISO } from "date-fns";
import { ar, fr } from "date-fns/locale";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  todayISO,
  startOfWeekISO,
  startOfMonthISO,
  startOfQuarterISO,
} from "@/lib/date";
import { Popover } from "./Popover";
import "./datepicker.css";

export type RangePreset =
  | "today"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "thisWeek"
  | "thisMonth"
  | "thisQuarter"
  | "custom";

export interface RangeValue {
  from: string;
  to: string;
}

export interface DateRangePickerProps {
  value: RangeValue;
  activePreset?: RangePreset;
  onChange: (range: RangeValue, preset: RangePreset) => void;
  presets?: RangePreset[];
  min?: string;
  max?: string;
  size?: "sm" | "md";
  align?: "start" | "end";
  numberOfMonths?: number;
}

const SIZES = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-10 px-3 text-[14px] gap-2",
} as const;

const DEFAULT_PRESETS: RangePreset[] = [
  "today",
  "last7days",
  "last30days",
  "thisMonth",
  "custom",
];

function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeForPreset(preset: RangePreset, current: RangeValue): RangeValue {
  const today = todayISO();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = isoOffsetDays(1);
      return { from: y, to: y };
    }
    case "last7days":
      return { from: isoOffsetDays(6), to: today };
    case "last30days":
      return { from: isoOffsetDays(29), to: today };
    case "thisWeek":
      return { from: startOfWeekISO(), to: today };
    case "thisMonth":
      return { from: startOfMonthISO(), to: today };
    case "thisQuarter":
      return { from: startOfQuarterISO(), to: today };
    case "custom":
    default:
      return current;
  }
}

function isoToDate(iso: string): Date {
  return parseISO(iso);
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({
  value,
  activePreset = "custom",
  onChange,
  presets = DEFAULT_PRESETS,
  min,
  max,
  size = "sm",
  align = "start",
  numberOfMonths,
}: DateRangePickerProps) {
  const t = useTranslations("datePicker");
  const locale = useLocale();
  const dfnsLocale = locale === "ar" ? ar : fr;
  const isRtl = locale === "ar";
  const isMobile = useIsMobile();
  const months = numberOfMonths ?? (isMobile ? 1 : 2);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const fromDate = isoToDate(value.from);
  const toDate = isoToDate(value.to);

  const triggerLabel =
    value.from === value.to
      ? format(fromDate, "PPP", { locale: dfnsLocale })
      : `${format(fromDate, "d MMM", { locale: dfnsLocale })} → ${format(toDate, "d MMM yyyy", { locale: dfnsLocale })}`;

  function handlePreset(preset: RangePreset) {
    const next = rangeForPreset(preset, value);
    onChange(next, preset);
    if (preset !== "custom") setOpen(false);
  }

  function handleCalendarSelect(range: DateRange | undefined) {
    setDraft(range);
    if (range?.from && range.to) {
      onChange(
        { from: dateToISO(range.from), to: dateToISO(range.to) },
        "custom",
      );
      setDraft(undefined);
      setOpen(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDraft(undefined);
      }}
      align={align}
      panelClassName="overflow-hidden"
      trigger={
        <button
          type="button"
          className={`inline-flex items-center justify-between rounded-lg border border-line bg-surface-card text-ink-primary hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-ink-primary focus:ring-offset-1 transition-colors ${SIZES[size]}`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <CalendarRange
              size={14}
              strokeWidth={1.75}
              className="shrink-0 text-ink-secondary"
            />
            <span className="truncate">{triggerLabel}</span>
          </span>
        </button>
      }
    >
      <div
        dir={isRtl ? "rtl" : "ltr"}
        className={`flex ${isMobile ? "flex-col" : "flex-row"} `}
      >
        <ul
          className={`flex ${isMobile ? "flex-row gap-1 overflow-x-auto border-b border-line p-2" : "flex-col gap-0.5 border-e border-line p-2"} ${isMobile ? "" : "min-w-[160px]"}`}
        >
          {presets.map((preset) => {
            const isActive = activePreset === preset;
            return (
              <li key={preset} className={isMobile ? "shrink-0" : ""}>
                <button
                  type="button"
                  onClick={() => handlePreset(preset)}
                  aria-pressed={isActive}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-surface-selected text-ink-primary"
                      : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
                  } ${isMobile ? "" : "w-full text-start"}`}
                >
                  {t(`presets.${preset}`)}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="p-2">
          <DayPicker
            className="oms-rdp"
            mode="range"
            selected={draft ?? { from: fromDate, to: toDate }}
            onSelect={handleCalendarSelect}
            numberOfMonths={months}
            locale={dfnsLocale}
            dir={isRtl ? "rtl" : "ltr"}
            weekStartsOn={isRtl ? 6 : 1}
            disabled={[
              ...(min ? [{ before: isoToDate(min) }] : []),
              ...(max ? [{ after: isoToDate(max) }] : []),
            ]}
            labels={{
              labelPrevious: () => t("prevMonth"),
              labelNext: () => t("nextMonth"),
            }}
          />
        </div>
      </div>
    </Popover>
  );
}
