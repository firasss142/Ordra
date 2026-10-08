"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

/**
 * A number as a stepper: « − 8 appels + ». Keeps the text while you type so an
 * empty box is allowed mid-edit; emits `null` for empty, a number otherwise.
 * The buttons step by `step` and stay inside min/max.
 */
export function NumberField({
  value,
  onChange,
  unit,
  prefix,
  label,
  min = 0,
  max,
  step = 1,
  dirty = false,
  width = 52,
  fill = false,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  unit?: string;
  prefix?: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  dirty?: boolean;
  width?: number;
  /** Stretch to the parent's width (drawer fields). */
  fill?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((prev) => (prev === "" && value === null) || Number(prev) === value ? prev : value === null ? "" : String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  const bump = (dir: 1 | -1) => {
    const base = value ?? min;
    // Round away float noise from fractional steps (0.5 % surcharge).
    const next = clamp(Math.round((base + dir * step) * 1000) / 1000);
    setText(String(next));
    onChange(next);
  };

  return (
    <span className={`rg-stp${dirty ? " dirty" : ""}${fill ? " fill" : ""}`}>
      <button type="button" tabIndex={-1} aria-hidden onClick={() => bump(-1)} disabled={value !== null && value <= min}>
        <Minus />
      </button>
      {prefix && <span className="pf">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        dir="ltr"
        aria-label={label}
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value === "" ? null : Number(e.target.value));
        }}
        style={fill ? undefined : { width }}
      />
      {unit && <span className="u">{unit}</span>}
      <button type="button" tabIndex={-1} aria-hidden onClick={() => bump(1)} disabled={max !== undefined && value !== null && value >= max}>
        <Plus />
      </button>
    </span>
  );
}
