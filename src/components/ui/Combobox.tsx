"use client";

import { useState, useRef, useEffect } from "react";
import { useDebounce } from "@/hooks/useDebounce";

export interface ComboboxOption {
  id: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onCommit: (id: string, label: string) => Promise<void> | void;
  loadOptions?: (query: string) => Promise<ComboboxOption[]>;
  placeholder?: string;
  /** Legacy: still works. Renders value as unstyled text, no edit. */
  readOnly?: boolean;
  /**
   * Display-mode: renders value as clean styled text.
   * Click activates the dropdown. Pass readOnly to prevent editing.
   */
  displayMode?: boolean;
  /** Extra classes applied to the display-mode text span. */
  displayClassName?: string;
  className?: string;
}

export function Combobox({
  value,
  options,
  onCommit,
  loadOptions,
  placeholder = "Rechercher…",
  readOnly,
  displayMode,
  displayClassName = "",
  className = "",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [asyncOptions, setAsyncOptions] = useState<ComboboxOption[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleOptions = (asyncOptions ?? options).filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const debouncedQuery = useDebounce(query, 200);
  useEffect(() => {
    if (!open || !loadOptions) return;
    let cancelled = false;
    loadOptions(debouncedQuery).then((opts) => {
      if (!cancelled) setAsyncOptions(opts);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open, loadOptions]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  async function select(opt: ComboboxOption) {
    close();
    if (opt.label === value) return;
    await onCommit(opt.id, opt.label);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, visibleOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = visibleOptions[highlighted];
      if (opt) select(opt);
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

  const dropdown = open && (
    <div
      style={{
        position: "absolute",
        zIndex: 50,
        insetInlineStart: 0,
        marginTop: 4,
        width: "100%",
        minWidth: 180,
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
      }}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded="true"
        value={query}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 14,
          color: "#1A1A1A",
          backgroundColor: "#FFFFFF",
          border: "none",
          borderBottom: "1px solid #E1E3E5",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <ul
        style={{
          maxHeight: 192,
          overflowY: "auto",
          padding: "4px 0",
          margin: 0,
          listStyle: "none",
        }}
      >
        {visibleOptions.length === 0 ? (
          <li style={{ padding: "8px 12px", fontSize: 14, color: "#6D7175" }}>—</li>
        ) : (
          visibleOptions.map((opt, i) => (
            <li
              key={opt.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(opt)}
              style={{
                cursor: "pointer",
                padding: "6px 12px",
                fontSize: 14,
                color: "#1A1A1A",
                backgroundColor: i === highlighted ? "#F2F2F2" : "transparent",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLLIElement).style.backgroundColor =
                  i === highlighted ? "#F2F2F2" : "#F7F7F7")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLLIElement).style.backgroundColor =
                  i === highlighted ? "#F2F2F2" : "transparent")
              }
            >
              {opt.label}
              {opt.hint && (
                <span style={{ marginInlineStart: 8, fontSize: 12, color: "#6D7175" }}>
                  {opt.hint}
                </span>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );

  // Display mode: styled text, click opens dropdown
  if (displayMode) {
    return (
      <div ref={containerRef} className={className} style={{ position: "relative" }}>
        <span
          role={readOnly ? undefined : "button"}
          tabIndex={readOnly ? undefined : 0}
          onClick={() => { if (!readOnly) setOpen((o) => !o); }}
          onKeyDown={(e) => {
            if (!readOnly && (e.key === "Enter" || e.key === " ")) setOpen((o) => !o);
            if (e.key === "Escape") close();
          }}
          className={[
            "block text-[14px] text-ink-primary leading-snug",
            !readOnly
              ? "cursor-pointer rounded px-1 -mx-1 hover:bg-surface-selected transition-colors duration-fast"
              : "",
            !value ? "text-ink-muted italic" : "",
            displayClassName,
          ].join(" ")}
        >
          {value || placeholder}
        </span>
        {dropdown}
      </div>
    );
  }

  // Standard editable trigger button
  const triggerStyle: React.CSSProperties = {
    width: "100%",
    height: 32,
    padding: "0 10px",
    fontSize: 14,
    textAlign: "start",
    color: value ? "#1A1A1A" : "#6D7175",
    backgroundColor: "#FFFFFF",
    border: "1px solid #D1D5DB",
    borderRadius: 6,
    cursor: "pointer",
    transition: "border-color 120ms ease",
    boxSizing: "border-box",
  };

  return (
    <div ref={containerRef} className={className} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={triggerStyle}>
        {value || placeholder}
      </button>
      {dropdown}
    </div>
  );
}
