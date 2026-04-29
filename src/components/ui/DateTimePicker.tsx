"use client";

import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { DatePicker } from "./DatePicker";

export interface DateTimePresetOption {
  label: string;
  offsetHours: number;
}

export interface DateTimePickerProps {
  value: string | null;
  onChange: (iso: string | null) => void;
  min?: string;
  max?: string;
  presets?: DateTimePresetOption[];
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
}

function isoToParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${hh}:${mm}` };
}

function partsToISO(date: string, time: string): string | null {
  if (!date || !time) return null;
  const combined = new Date(`${date}T${time}:00`);
  if (Number.isNaN(combined.getTime())) return null;
  return combined.toISOString();
}

export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  presets,
  size = "sm",
  disabled,
  ariaLabel,
}: DateTimePickerProps) {
  const t = useTranslations("datePicker");
  const { date, time } = isoToParts(value);
  const minDate = min ? isoToParts(min).date : undefined;
  const maxDate = max ? isoToParts(max).date : undefined;

  function emit(nextDate: string, nextTime: string) {
    if (nextDate && nextTime) {
      const iso = partsToISO(nextDate, nextTime);
      if (iso) onChange(iso);
    }
  }

  function applyPreset(p: DateTimePresetOption) {
    const d = new Date();
    d.setHours(d.getHours() + p.offsetHours);
    onChange(d.toISOString());
  }

  const inputHeight = size === "md" ? "h-10" : "h-8";

  return (
    <div className="flex flex-col gap-2">
      {presets && presets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              disabled={disabled}
              className="rounded-md border border-line bg-surface-card px-2.5 py-1 text-[12px] font-medium text-ink-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <DatePicker
            value={date || null}
            onChange={(d) => emit(d ?? "", time)}
            min={minDate}
            max={maxDate}
            disabled={disabled}
            size={size}
            ariaLabel={ariaLabel ?? t("placeholder")}
          />
        </div>
        <div
          className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-card px-2.5 ${inputHeight} focus-within:ring-2 focus-within:ring-ink-primary focus-within:ring-offset-1`}
        >
          <Clock size={14} strokeWidth={1.75} className="text-ink-secondary" />
          <input
            type="time"
            value={time}
            disabled={disabled}
            onChange={(e) => emit(date, e.target.value)}
            aria-label={t("pickTime")}
            className="border-0 bg-transparent text-[13px] font-medium text-ink-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
