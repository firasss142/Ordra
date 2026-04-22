"use client";

import { useState, useRef } from "react";

interface StepperFieldProps {
  value: number;
  onCommit: (value: number) => Promise<void> | void;
  min?: number;
  max?: number;
  readOnly?: boolean;
  className?: string;
}

export function StepperField({
  value,
  onCommit,
  min = 1,
  max,
  readOnly,
  className = "",
}: StepperFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const original = useRef(String(value));

  const prevValue = useRef(String(value));
  if (prevValue.current !== String(value)) {
    prevValue.current = String(value);
    original.current = String(value);
    setDraft(String(value));
  }

  async function step(delta: number) {
    const current = parseInt(draft, 10);
    const next = isNaN(current) ? value + delta : current + delta;
    if (min !== undefined && next < min) return;
    if (max !== undefined && next > max) return;
    setDraft(String(next));
    await onCommit(next);
  }

  async function handleBlur() {
    const parsed = parseInt(draft, 10);
    if (isNaN(parsed) || draft === original.current) {
      setDraft(original.current);
      return;
    }
    const clamped = max !== undefined
      ? Math.min(Math.max(parsed, min), max)
      : Math.max(parsed, min);
    setDraft(String(clamped));
    if (String(clamped) !== original.current) {
      await onCommit(clamped);
    }
  }

  if (readOnly) {
    return (
      <span className={className} style={{ fontSize: 14, color: "#1A1A1A" }}>
        {value}
      </span>
    );
  }

  const buttonStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    color: "#1A1A1A",
    border: "1px solid #D1D5DB",
    borderRadius: 4,
    fontSize: 14,
    lineHeight: 1,
    cursor: "pointer",
    transition: "background-color 120ms ease",
  };

  const current = parseInt(draft, 10);
  const decDisabled = !isNaN(current) && current <= min;
  const incDisabled = max !== undefined && !isNaN(current) && current >= max;

  return (
    <div
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <button
        type="button"
        aria-label="decrement"
        onClick={() => step(-1)}
        disabled={decDisabled}
        style={{
          ...buttonStyle,
          opacity: decDisabled ? 0.4 : 1,
          cursor: decDisabled ? "not-allowed" : "pointer",
        }}
      >
        −
      </button>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
          if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
          if (e.key === "Enter") { e.currentTarget.blur(); }
        }}
        style={{
          width: 56,
          height: 32,
          padding: "0 8px",
          fontSize: 14,
          textAlign: "center",
          color: "#1A1A1A",
          backgroundColor: "#FFFFFF",
          border: "1px solid #D1D5DB",
          borderRadius: 6,
          outline: "none",
          boxSizing: "border-box",
          fontVariantNumeric: "tabular-nums",
        }}
        min={min}
        max={max}
      />
      <button
        type="button"
        aria-label="increment"
        onClick={() => step(1)}
        disabled={incDisabled}
        style={{
          ...buttonStyle,
          opacity: incDisabled ? 0.4 : 1,
          cursor: incDisabled ? "not-allowed" : "pointer",
        }}
      >
        +
      </button>
    </div>
  );
}
