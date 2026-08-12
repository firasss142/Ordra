"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search, X } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDebounce } from "@/hooks/useDebounce";
import { parseSearch, SEARCH_PREFIX_HINTS, type SearchField } from "@/lib/orders/search-query";

/**
 * The orders search box.
 *
 * What it replaces was a 38px input, a magnifier and nothing else: no way to
 * clear it but selecting the text, no sign that a request was in flight, no
 * statement of what it searches, and no hint that `tel:` or `ville:` existed
 * because they did not. On a page whose other instruments are a KPI strip and
 * seven named facets, the one control an operator reaches for first was the
 * least designed thing on it.
 *
 * Three additions, each answering a question the old box left open:
 *
 *  · *Is it working?* — the magnifier becomes a spinner while the list is
 *    fetching. Half of "slow" is not knowing whether anything is happening.
 *  · *Did it understand me?* — when the box reads a term as something other
 *    than literal text (a phone number reduced to its national digits, a
 *    `ville:` prefix), it says so in a chip. Typing `0925782017` and seeing
 *    "Téléphone · 925782017" is the difference between trusting the result and
 *    wondering whether the search is broken.
 *  · *What can I type?* — the prefixes are offered on focus, and clicking one
 *    inserts it.
 *
 * Interpretation lives in `lib/orders/search-query`, the same module the API
 * uses, so what the chip claims and what Postgres does cannot drift.
 */

interface Props {
  /** The applied query — `filters.q`, not the keystroke. */
  value: string;
  /** Called with the debounced query. */
  onChange: (q: string) => void;
  /** True while the list is fetching, so the box can say it is working. */
  busy?: boolean;
}

/** How long to sit on a keystroke. Short enough to feel live, long enough that
 *  a full phone number is one request rather than ten. */
const DEBOUNCE_MS = 180;

export function OrdersSearchBar({ value, onChange, busy = false }: Props) {
  const t = useTranslations("orders.filters");
  const ts = useTranslations("orders.search");
  const isMobile = useIsMobile();

  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const debounced = useDebounce(local, DEBOUNCE_MS);
  const lastSent = useRef(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounced === lastSent.current) return;
    lastSent.current = debounced;
    onChange(debounced);
  }, [debounced, onChange]);

  // Filters cleared from elsewhere (a chip, "tout effacer") must empty the box.
  useEffect(() => {
    if (value !== lastSent.current) {
      setLocal(value);
      lastSent.current = value;
    }
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Only the terms whose reading is not obvious from the text.
   *
   * A chip for every word would be noise — "salima" searched as "salima" tells
   * nobody anything. A chip earns its place when the box did something: aimed a
   * term at one field, or rewrote a number into the digits it will actually
   * match on.
   */
  const readings = useMemo(
    () =>
      parseSearch(local).filter(
        (term) => term.field !== null || (term.phone !== null && term.phone !== local.trim()),
      ),
    [local],
  );

  const clear = () => {
    setLocal("");
    inputRef.current?.focus();
  };

  const insertPrefix = (prefix: string) => {
    setLocal((q) => (q.trim() ? `${q.trim()} ${prefix}` : prefix));
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={
          "relative flex h-11 items-center rounded-lg border bg-oms-surface transition-[border-color,box-shadow] duration-fast " +
          (focused
            ? "border-brand shadow-[0_0_0_3px_var(--brand-bg)]"
            : "border-oms-border hover:border-oms-border-strong")
        }
      >
        <span
          aria-hidden
          className="grid w-10 flex-none place-items-center text-oms-ink-3"
        >
          {busy ? (
            <Loader2 size={16} strokeWidth={2} className="animate-spin text-brand" />
          ) : (
            <Search size={16} strokeWidth={2} />
          )}
        </span>

        <input
          ref={inputRef}
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && local) {
              e.preventDefault();
              e.stopPropagation();
              clear();
            }
          }}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAria")}
          // The box states its own scope. A placeholder that reads "Nom ·
          // téléphone · référence" is the only documentation this control has,
          // and it was three fields short of the truth.
          aria-describedby="orders-search-scope"
          className="h-full min-w-0 flex-1 bg-transparent pe-2 text-[14px] text-oms-ink-1 outline-none placeholder:text-oms-ink-3"
        />

        {local && (
          <button
            type="button"
            onClick={clear}
            aria-label={ts("clear")}
            className="grid h-7 w-7 flex-none place-items-center rounded-full text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
          >
            <X size={14} strokeWidth={2.2} aria-hidden />
          </button>
        )}

        {!isMobile && !local && (
          <kbd
            aria-hidden
            className="me-2.5 flex-none rounded border border-oms-border bg-oms-sunken px-1.5 py-px text-[10.5px] font-medium text-oms-ink-3"
          >
            /
          </kbd>
        )}
      </div>

      {/* One line under the box, carrying whichever of three things is useful:
          what it understood, what you can type, or what it covers. */}
      <div className="flex min-h-[18px] flex-wrap items-center gap-1.5 px-0.5 text-[11.5px]">
        {readings.length > 0 ? (
          readings.map((term, i) => (
            <span
              key={`${term.field ?? "free"}-${term.value}-${i}`}
              data-testid="search-reading"
              className="inline-flex items-center gap-1 rounded-pill border border-brand bg-brand-bg px-2 py-px font-medium text-brand-hover"
            >
              {ts(`fields.${term.field ?? "phone"}` as `fields.${SearchField}`)}
              <span aria-hidden className="opacity-40">
                ·
              </span>
              <span className="tabular-nums">{term.phone ?? term.value}</span>
            </span>
          ))
        ) : focused ? (
          <>
            <span className="text-oms-ink-3">{ts("tryPrefix")}</span>
            {SEARCH_PREFIX_HINTS.map((p) => (
              <button
                key={p}
                type="button"
                // Mouse-down, not click: the input's blur would close this row
                // before a click ever landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertPrefix(p);
                }}
                className="rounded-md border border-oms-border bg-oms-sunken px-1.5 py-px font-medium text-oms-ink-2 transition-colors duration-fast hover:border-brand hover:text-brand-hover"
              >
                {p}
              </button>
            ))}
          </>
        ) : (
          <span className="text-oms-ink-3">{ts("scope")}</span>
        )}
      </div>

      {/* The scope is the box's only documentation, and the line above trades
          it away for the reading chips. Keep one copy that never leaves, so
          `aria-describedby` always resolves. */}
      <span id="orders-search-scope" className="sr-only">
        {ts("scope")}
      </span>
    </div>
  );
}
