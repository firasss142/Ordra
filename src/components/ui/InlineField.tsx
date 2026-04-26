"use client";

import { useState, useRef, useCallback } from "react";

interface InlineFieldProps {
  value: string | number;
  onCommit: (value: string) => Promise<void> | void;
  validate?: (value: string) => string | null;
  type?: "text" | "tel" | "number";
  placeholder?: string;
  /** Legacy: still works. Renders value as unstyled text, no edit. */
  readOnly?: boolean;
  /**
   * Display-mode: renders value as clean styled text with no input chrome.
   * Click-to-edit: clicking the text activates the input.
   * Pass readOnly alongside to prevent editing entirely.
   */
  displayMode?: boolean;
  /** Extra classes applied to the display-mode text span. */
  displayClassName?: string;
  className?: string;
}

export function InlineField({
  value,
  onCommit,
  validate,
  type = "text",
  placeholder,
  readOnly,
  displayMode,
  displayClassName = "",
  className = "",
}: InlineFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [hasError, setHasError] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const original = useRef(String(value));

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
    [onCommit, validate],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur();
      tryCommit(draft);
    } else if (e.key === "Escape") {
      setDraft(original.current);
      setHasError(false);
      if (displayMode) setEditing(false);
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  // Pure read-only (no edit at all)
  if (readOnly && !displayMode) {
    return (
      <span className={className} style={{ fontSize: 14, color: "#1A1A1A" }}>
        {value}
      </span>
    );
  }

  // Display mode: styled text, click activates input
  if (displayMode) {
    if (editing && !readOnly) {
      return (
        <input
          ref={inputRef}
          type={type}
          value={draft}
          placeholder={placeholder}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            tryCommit(draft);
            setEditing(false);
          }}
          onKeyDown={handleKeyDown}
          className={`${hasError ? "border-status-critical " : ""}${className}`}
          style={{
            width: "100%",
            height: 34,
            padding: "0 10px",
            fontSize: 14,
            color: "#1A1A1A",
            backgroundColor: "#FFFFFF",
            border: `1px solid ${hasError ? "#D72C0D" : "#10B981"}`,
            borderRadius: 6,
            outline: "none",
            transition: "border-color 120ms ease",
            boxSizing: "border-box",
          }}
        />
      );
    }
    return (
      <span
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        onClick={() => { if (!readOnly) setEditing(true); }}
        onKeyDown={(e) => { if (!readOnly && (e.key === "Enter" || e.key === " ")) setEditing(true); }}
        className={[
          "block text-[14px] text-ink-primary leading-snug",
          !readOnly
            ? "cursor-text rounded px-1 -mx-1 hover:bg-surface-selected transition-colors duration-fast"
            : "",
          !value || String(value) === ""
            ? "text-ink-muted italic"
            : "",
          displayClassName,
        ].join(" ")}
      >
        {String(value) !== "" ? value : (placeholder ?? "—")}
      </span>
    );
  }

  // Standard editable input
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
