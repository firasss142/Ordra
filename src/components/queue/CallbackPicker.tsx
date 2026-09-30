"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";

interface CallbackPickerProps {
  defaultValue?: Date;
  onSelect: (dateTime: Date) => void;
  /**
   * The time on screen stopped being a valid answer (it is in the past). The
   * caller must disarm its submit: printing the error was not enough while the
   * last valid time stayed armed behind it.
   */
  onInvalid?: () => void;
}

function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toLocalTimeString(d: Date): string {
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// 16px on a phone: iOS Safari zooms the page into any focused field set
// smaller, and leaves it zoomed — the sheet ends up cropped off-screen.
// `min-w-0` because a native date input has an intrinsic width that otherwise
// pushes the pair past a 375px screen.
const INPUT_CLASSES =
  "h-11 w-full min-w-0 rounded border border-[#D1D5DB] bg-white px-3 text-[16px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A] focus:ring-1 focus:ring-[#1A1A1A] lg:h-10 lg:text-[14px]";

export function CallbackPicker({ defaultValue, onSelect, onInvalid }: CallbackPickerProps) {
  const t = useTranslations("queue");
  const [dateVal, setDateVal] = useState(
    defaultValue ? toLocalDateString(defaultValue) : ""
  );
  const [timeVal, setTimeVal] = useState(
    defaultValue ? toLocalTimeString(defaultValue) : ""
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  const handleChange = useCallback((newDate: string, newTime: string) => {
    if (newDate && newTime) {
      const combined = new Date(`${newDate}T${newTime}:00`);
      if (!isNaN(combined.getTime())) {
        if (combined <= new Date()) {
          setValidationError(t("scheduleMustBeFuture"));
          onInvalid?.();
        } else {
          setValidationError(null);
          onSelect(combined);
        }
      }
    }
  }, [onSelect, onInvalid, t]);

  function applyPreset() {
    const d = new Date();
    d.setHours(d.getHours() + 2);
    const newDate = toLocalDateString(d);
    const newTime = toLocalTimeString(d);
    setDateVal(newDate);
    setTimeVal(newTime);
    setValidationError(null);
    onSelect(d);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[14px] font-semibold text-[#1A1A1A]">{t("callbackTitle")}</div>
        <button
          type="button"
          // A Latin token: in an Arabic sheet bidi would print « 2h+ ».
          dir="ltr"
          onClick={applyPreset}
          className="h-9 rounded border border-[#D1D5DB] bg-white px-3 text-[13px] font-semibold text-[#1A1A1A] transition-colors duration-fast hover:bg-[#F3F4F6]"
        >
          +2h
        </button>
      </div>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] font-medium text-[#6B7280]">{t("scheduleDate")}</span>
          <input
            type="date"
            aria-label={t("callbackDateAria")}
            min={today}
            value={dateVal}
            onChange={(e) => {
              setDateVal(e.target.value);
              handleChange(e.target.value, timeVal);
            }}
            className={INPUT_CLASSES}
          />
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] font-medium text-[#6B7280]">{t("scheduleTime")}</span>
          <input
            type="time"
            aria-label={t("callbackTimeAria")}
            value={timeVal}
            onChange={(e) => {
              setTimeVal(e.target.value);
              handleChange(dateVal, e.target.value);
            }}
            className={INPUT_CLASSES}
          />
        </label>
      </div>
      {validationError && (
        <div role="alert" className="mt-1.5 text-[12px] text-[#DC2626]">
          {validationError}
        </div>
      )}
    </div>
  );
}
