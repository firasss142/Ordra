"use client";

import { useState, useRef, useCallback } from "react";

interface InlineFieldProps {
  value: string | number;
  onCommit: (value: string) => Promise<void> | void;
  validate?: (value: string) => string | null;
  type?: "text" | "tel" | "number";
  /**
   * Render a multi-line textarea instead of a single-line input. Enter inserts
   * a newline (does not commit); commit happens on blur. Escape still reverts.
   */
  multiline?: boolean;
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
  multiline,
  placeholder,
  readOnly,
  displayMode,
  displayClassName = "",
  className = "",
}: InlineFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [hasError, setHasError] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
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

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    // In multiline mode Enter inserts a newline rather than committing — the
    // commit happens on blur. Single-line fields commit on Enter as before.
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      e.currentTarget.blur();
      tryCommit(draft);
    } else if (e.key === "Escape") {
      setDraft(original.current);
      setHasError(false);
      if (displayMode) setEditing(false);
      e.currentTarget.blur();
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
      const sharedStyle = {
        width: "100%",
        padding: multiline ? "8px 10px" : "0 10px",
        fontSize: 14,
        lineHeight: 1.45,
        color: "#1A1A1A",
        backgroundColor: "#FFFFFF",
        border: `1px solid ${hasError ? "#D72C0D" : "#10B981"}`,
        borderRadius: 6,
        outline: "none",
        transition: "border-color 120ms ease",
        boxSizing: "border-box" as const,
      };
      if (multiline) {
        return (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={draft}
            placeholder={placeholder}
            autoFocus
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              tryCommit(draft);
              setEditing(false);
            }}
            onKeyDown={handleKeyDown}
            className={`${hasError ? "border-status-critical " : ""}${className}`}
            style={{ ...sharedStyle, resize: "vertical", minHeight: 56 }}
          />
        );
      }
      return (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
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
          style={{ ...sharedStyle, height: 34 }}
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
  const standardStyle = {
    width: "100%",
    padding: multiline ? "8px 10px" : "0 10px",
    fontSize: 14,
    lineHeight: 1.45,
    color: "#1A1A1A",
    backgroundColor: "#FFFFFF",
    border: `1px solid ${hasError ? "#D72C0D" : "#D1D5DB"}`,
    borderRadius: 6,
    outline: "none",
    transition: "border-color 120ms ease",
    boxSizing: "border-box" as const,
  };
  if (multiline) {
    return (
      <textarea
        value={draft}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => tryCommit(draft)}
        onKeyDown={handleKeyDown}
        className={`${hasError ? "border-red-600 " : ""}${className}`}
        style={{ ...standardStyle, resize: "vertical", minHeight: 56 }}
      />
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
      style={{ ...standardStyle, height: 32 }}
    />
  );
}
