"use client";

import { useEffect, useState } from "react";

/**
 * A number with its unit inside the box (prototype `.nin`): « [ 8 | appels ] ».
 * Keeps the text while you type so an empty box is allowed mid-edit; emits
 * `null` for empty, a number otherwise.
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
  width = 76,
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

  return (
    <label
      className={`inline-flex h-[36px] items-stretch overflow-hidden rounded-[6px] border bg-white focus-within:border-brand focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-brand ${dirty ? "border-status-warning" : "border-[#D2D5D9]"} ${fill ? "w-full" : ""}`}
    >
      {prefix && (
        <span className="flex items-center whitespace-nowrap border-e border-line-subtle bg-surface-sunken px-[10px] text-[13px] text-ink-secondary">
          {prefix}
        </span>
      )}
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
        className={`border-0 bg-transparent px-[10px] text-end text-[14px] tabular-nums text-ink-primary outline-none ${fill ? "min-w-0 flex-1" : ""}`}
      />
      {unit && (
        <span className="flex items-center whitespace-nowrap border-s border-line-subtle bg-surface-sunken px-[10px] text-[13px] text-ink-secondary">
          {unit}
        </span>
      )}
    </label>
  );
}
