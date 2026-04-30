"use client";

import { useState } from "react";
import { Calendar, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DayPicker } from "react-day-picker";
import { format, parseISO } from "date-fns";
import { ar, fr } from "date-fns/locale";
import { Popover } from "./Popover";
import "./datepicker.css";

export interface DatePickerProps {
  value: string | null;
  onChange: (date: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  ariaLabel?: string;
  align?: "start" | "end";
  allowClear?: boolean;
}

const SIZES = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-10 px-3 text-[14px] gap-2",
} as const;

function isoToDate(iso: string | null): Date | undefined {
  if (!iso) return undefined;
  return parseISO(iso);
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled,
  size = "sm",
  ariaLabel,
  align = "start",
  allowClear = false,
}: DatePickerProps) {
  const t = useTranslations("datePicker");
  const locale = useLocale();
  const dfnsLocale = locale === "ar" ? ar : fr;
  const isRtl = locale === "ar";
  const [open, setOpen] = useState(false);

  const selected = isoToDate(value);
  const minDate = isoToDate(min ?? null);
  const maxDate = isoToDate(max ?? null);

  const label = selected
    ? format(selected, "PPP", { locale: dfnsLocale })
    : (placeholder ?? t("placeholder"));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      panelClassName="p-2"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={`inline-flex items-center justify-between rounded-lg border border-line bg-surface-card text-ink-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ink-primary focus:ring-offset-1 transition-colors ${SIZES[size]}`}
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Calendar size={14} strokeWidth={1.75} className="shrink-0 text-ink-secondary" />
            <span className={`truncate ${selected ? "" : "text-ink-secondary"}`}>{label}</span>
          </span>
          {allowClear && selected ? (
            <span
              role="button"
              aria-label={t("clear")}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(null);
                }
              }}
              className="ms-2 flex h-4 w-4 items-center justify-center rounded text-ink-secondary hover:bg-surface-selected hover:text-ink-primary"
            >
              <X size={12} strokeWidth={2} />
            </span>
          ) : null}
        </button>
      }
    >
      <div dir={isRtl ? "rtl" : "ltr"}>
        <DayPicker
          className="oms-rdp"
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              onChange(dateToISO(d));
              setOpen(false);
            }
          }}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          locale={dfnsLocale}
          dir={isRtl ? "rtl" : "ltr"}
          weekStartsOn={isRtl ? 6 : 1}
          labels={{
            labelPrevious: () => t("prevMonth"),
            labelNext: () => t("nextMonth"),
          }}
        />
      </div>
    </Popover>
  );
}
