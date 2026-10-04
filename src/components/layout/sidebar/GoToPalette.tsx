"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";

/*
 * « Aller à… » (⌘K / Ctrl K): jump to any page of the bar, or switch market,
 * by typing. Navigation only — finding an order by phone is another feature.
 * A light dialog over the content, like every other dialog in Ordra; portalled
 * because the phone drawer is transformed, which would trap a fixed child.
 */

export interface PaletteEntry {
  id: string;
  label: string;
  /** The group name, shown on the right and searchable. */
  group?: string;
  icon: ReactNode;
  onSelect: () => void;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function GoToPalette({ open, entries, onClose }: { open: boolean; entries: PaletteEntry[]; onClose: () => void }) {
  const t = useTranslations("nav");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focus comes from autoFocus; hand it back to whatever opened us.
    const returnTo = document.activeElement as HTMLElement | null;
    return () => returnTo?.focus?.();
  }, [open]);

  const matches = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return entries;
    return entries.filter((e) => fold(e.label).includes(q) || (e.group ? fold(e.group).includes(q) : false));
  }, [entries, query]);

  if (!open || typeof document === "undefined") return null;

  const pick = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.onSelect();
  };
  const at = Math.min(cursor, Math.max(matches.length - 1, 0));

  return createPortal(
    <div
      className="sb-goto-wrap"
      data-testid="goto-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sb-goto" role="dialog" aria-modal="true" aria-label={t("goTo")}>
        <div className="sb-goto-in">
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={matches.length ? `${listId}-${at}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={t("goToPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, matches.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(matches[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
        </div>
        <div className="sb-goto-res" id={listId} role="listbox" aria-label={t("goTo")}>
          {matches.length === 0 ? (
            <div className="sb-goto-empty">{t("goToEmpty")}</div>
          ) : (
            matches.map((entry, n) => (
              <button
                key={entry.id}
                id={`${listId}-${n}`}
                type="button"
                role="option"
                aria-selected={n === at}
                className="sb-goto-row"
                tabIndex={-1}
                onMouseEnter={() => setCursor(n)}
                onClick={() => pick(entry)}
                ref={(el) => {
                  if (n === at) el?.scrollIntoView?.({ block: "nearest" });
                }}
              >
                {entry.icon}
                <span>{entry.label}</span>
                {entry.group ? <span className="sb-goto-group">{entry.group}</span> : null}
              </button>
            ))
          )}
        </div>
        <div className="sb-goto-foot">
          <span>{t("goToHints.choose")}</span>
          <span>{t("goToHints.open")}</span>
          <span>{t("goToHints.close")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
