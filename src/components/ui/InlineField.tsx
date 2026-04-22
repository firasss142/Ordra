"use client";

import { useState, useRef, useCallback } from "react";

interface InlineFieldProps {
  value: string | number;
  onCommit: (value: string) => Promise<void> | void;
  validate?: (value: string) => string | null;
  type?: "text" | "tel" | "number";
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
}

export function InlineField({
  value,
  onCommit,
  validate,
  type = "text",
  placeholder,
  readOnly,
  className = "",
}: InlineFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [hasError, setHasError] = useState(false);
  const original = useRef(String(value));

  // Keep in sync when parent value changes (after commit)
  const prevValue = useRef(String(value));
  if (prevValue.current !== String(value)) {
    prevValue.current = String(value);
    original.current = String(value);
    setDraft(String(value));
  }

  const tryCommit = useCallback(
    async (val: string) => {
      if (val === original.current) return;
      if (validate) {
        const err = validate(val);
        if (err) {
          setHasError(true);
          setTimeout(() => setHasError(false), 2000);
          return;
        }
      }
      await onCommit(val);
    },
    [onCommit, validate]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
      tryCommit(draft);
    } else if (e.key === "Escape") {
      setDraft(original.current);
      setHasError(false);
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  if (readOnly) {
    return (
      <span
        className={className}
        style={{ fontSize: 14, color: "#1A1A1A" }}
      >
        {value}
      </span>
    );
  }

  return (
    <input
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => tryCommit(draft)}
      onKeyDown={handleKeyDown}
      className={`${hasError ? "border-red-600 " : ""}${className}`}
      style={{
        width: "100%",
        height: 32,
        padding: "0 10px",
        fontSize: 14,
        color: "#1A1A1A",
        backgroundColor: "#FFFFFF",
        border: `1px solid ${hasError ? "#D72C0D" : "#D1D5DB"}`,
        borderRadius: 6,
        outline: "none",
        transition: "border-color 120ms ease",
        boxSizing: "border-box",
      }}
    />
  );
}
