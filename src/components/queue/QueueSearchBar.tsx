"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Clock } from "lucide-react";
import { useQueueSearch } from "@/context/queue-search";

export const RECENT_SEARCHES_KEY = "oms.agent.recentSearches";
const MAX_RECENT = 5;

interface Props {
  /**
   * "navbar" sits inside the agent Topbar (compact, no surrounding band, reads
   * its state from QueueSearchContext). "page" is the standalone band used in
   * isolation/tests with explicitly passed props.
   */
  variant?: "navbar" | "page";
  /** Explicit overrides — used by the "page" variant and tests. */
  value?: string;
  onChange?: (raw: string) => void;
  resultCount?: number;
  isSearching?: boolean;
  /** Forwarded so the parent can focus the input on the "/" shortcut. */
  inputRef?: React.Ref<HTMLInputElement | null>;
}

export function readRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  if (typeof window === "undefined") return;
  const term = query.trim();
  if (term.length < 2) return;
  const existing = readRecentSearches().filter((q) => q.toLowerCase() !== term.toLowerCase());
  const next = [term, ...existing].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable — recent searches are best-effort */
  }
}

export function QueueSearchBar({
  variant = "page",
  value: valueProp,
  onChange: onChangeProp,
  resultCount: resultCountProp,
  isSearching: isSearchingProp,
  inputRef: inputRefProp,
}: Props) {
  const t = useTranslations("queue.search");
  const ctx = useQueueSearch();
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Explicit props win (page variant / tests); otherwise read from context.
  const value = valueProp ?? ctx.query;
  const onChange = onChangeProp ?? ctx.setQuery;
  const resultCount = resultCountProp ?? ctx.resultCount;
  const isSearching = isSearchingProp ?? value.trim().length > 0;
  const inputRef = inputRefProp ?? ctx.inputRef;
  const isNavbar = variant === "navbar";

  // Refresh recent list whenever the dropdown is about to show.
  const showRecent = focused && value.trim().length === 0;
  useEffect(() => {
    if (showRecent) setRecent(readRecentSearches());
  }, [showRecent]);

  // Close the recent dropdown on outside click.
  useEffect(() => {
    if (!focused) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [focused]);

  const countLabel =
    resultCount === 1 ? t("resultCount", { count: 1 }) : t("resultCountPlural", { count: resultCount });

  return (
    <div className={isNavbar ? "w-full max-w-[560px]" : "bg-agent-bg px-8 pt-6 pb-1"}>
      <div ref={wrapRef} className={isNavbar ? "relative w-full" : "relative max-w-[640px]"}>
        <div
          className={[
            "flex items-center gap-2 ps-3 pe-2 rounded-pill bg-agent-surface",
            isNavbar ? "h-10" : "h-11",
            "border transition-colors duration-fast",
            focused
              ? "border-agent-primary ring-2 ring-agent-primary/15"
              : "border-agent-outline-variant hover:border-agent-outline",
          ].join(" ")}
        >
          <Search
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className="shrink-0 text-agent-on-surface-variant"
          />
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            type="search"
            role="searchbox"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (value.length > 0) {
                  onChange("");
                } else {
                  e.currentTarget.blur();
                  setFocused(false);
                }
              }
            }}
            placeholder={t("placeholder")}
            aria-label={t("aria")}
            // Hide the browser's native search clear so ours is the only one.
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] text-agent-on-surface placeholder:text-agent-on-surface-variant/70 [&::-webkit-search-cancel-button]:appearance-none"
          />

          {isSearching && (
            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-agent-on-surface-variant whitespace-nowrap">
              {countLabel}
            </span>
          )}

          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={t("clear")}
              className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-agent-on-surface-variant hover:bg-agent-surface-high hover:text-agent-on-surface transition-colors duration-fast"
            >
              <X size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex shrink-0 items-center justify-center min-w-[20px] h-[20px] px-1.5 me-1 rounded border border-agent-outline-variant bg-agent-surface-high text-[11px] font-semibold text-agent-on-surface-variant">
              /
            </kbd>
          )}
        </div>

        {/* Field-prefix hint, shown only while focused & typing */}
        {focused && value.trim().length > 0 && (
          <p className="mt-1.5 ps-3 text-[11.5px] text-agent-on-surface-variant/80">
            {t("fieldHints")}
          </p>
        )}

        {/* Recent searches dropdown */}
        {showRecent && recent.length > 0 && (
          <div
            role="listbox"
            aria-label={t("recentTitle")}
            className="absolute z-30 mt-1.5 start-0 w-full max-w-[640px] bg-agent-surface border border-agent-outline-variant rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] py-2"
          >
            <div className="flex items-center justify-between px-4 pb-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant">
                {t("recentTitle")}
              </span>
              <button
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
                  } catch {
                    /* ignore */
                  }
                  setRecent([]);
                }}
                className="text-[11px] font-medium text-agent-on-surface-variant hover:text-agent-on-surface transition-colors duration-fast"
              >
                {t("recentClear")}
              </button>
            </div>
            {recent.map((q) => (
              <button
                key={q}
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown (not onClick) so it fires before the input's blur
                // closes the dropdown.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(q);
                }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-start text-[13.5px] text-agent-on-surface hover:bg-agent-surface-high transition-colors duration-fast"
              >
                <Clock
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-agent-on-surface-variant/70"
                />
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
