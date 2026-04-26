"use client";

import { useState, useRef } from "react";

interface StepperFieldProps {
  value: number;
  onCommit: (value: number) => Promise<void> | void;
  min?: number;
  max?: number;
  /** Legacy: still works. Renders value as unstyled text, no edit. */
  readOnly?: boolean;
  /**
   * Display-mode: renders value as styled text with inline +/− controls
   * appearing only on hover. Pass readOnly to prevent editing entirely.
   */
  displayMode?: boolean;
  /** Extra classes applied to the display-mode container. */
  displayClassName?: string;
  className?: string;
}

export function StepperField({
  value,
  onCommit,
  min = 1,
  max,
  readOnly,
  displayMode,
  displayClassName = "",
  className = "",
}: StepperFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [hovered, setHovered] = useState(false);
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
    const clamped =
      max !== undefined
        ? Math.min(Math.max(parsed, min), max)
        : Math.max(parsed, min);
    setDraft(String(clamped));
    if (String(clamped) !== original.current) {
      await onCommit(clamped);
    }
  }

  // Pure read-only (no edit at all)
  if (readOnly && !displayMode) {
    return (
      <span className={className} style={{ fontSize: 14, color: "#1A1A1A" }}>
        {value}
      </span>
    );
  }

  // Display mode: compact "Qty: N" with hover stepper controls
  if (displayMode) {
    const current = parseInt(draft, 10);
    const decDisabled = !isNaN(current) && current <= min;
    const incDisabled = max !== undefined && !isNaN(current) && current >= max;

    return (
      <div
        className={["inline-flex items-center gap-1.5", displayClassName].join(" ")}
        onMouseEnter={() => !readOnly && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Decrement — only visible on hover in edit mode */}
        {hovered && !readOnly && (
          <button
            type="button"
            aria-label="decrement"
            onClick={() => step(-1)}
            disabled={decDisabled}
            className="inline-flex items-center justify-center w-5 h-5 rounded border border-line-subtle bg-surface-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed text-[14px] leading-none"
          >
            −
          </button>
        )}

        <span className="text-[14px] font-semibold text-ink-primary tabular-nums min-w-[1.5ch] text-center">
          {draft}
        </span>

        {/* Increment — only visible on hover in edit mode */}
        {hovered && !readOnly && (
          <button
            type="button"
            aria-label="increment"
            onClick={() => step(1)}
            disabled={incDisabled}
            className="inline-flex items-center justify-center w-5 h-5 rounded border border-line-subtle bg-surface-card text-ink-secondary hover:bg-surface-hover hover:text-ink-primary transition-colors duration-fast disabled:opacity-30 disabled:cursor-not-allowed text-[14px] leading-none"
          >
            +
          </button>
        )}
      </div>
    );
  }

  // Standard stepper with buttons + input
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
