"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDownUp, ChevronDown, Columns3, ListFilter, Search } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import {
  PRODUCT_FACETS,
  type ProductFacet,
  type ProductFacetCounts,
  type ProductSortKey,
  type SortDirection,
} from "@/types/product-list";
import { PRODUCT_COLUMNS } from "./ProductsTable";

/** Named sort presets for the dropdown. Column headers still sort ad hoc. */
export const SORT_PRESETS: { key: ProductSortKey; dir: SortDirection; labelKey: string }[] = [
  { key: "name", dir: "asc", labelKey: "sort.name" },
  { key: "revenue", dir: "desc", labelKey: "sort.revenueDesc" },
  { key: "net_profit", dir: "desc", labelKey: "sort.profitDesc" },
  { key: "margin_pct", dir: "asc", labelKey: "sort.marginAsc" },
  { key: "current_stock", dir: "asc", labelKey: "sort.stockAsc" },
  { key: "return_rate", dir: "desc", labelKey: "sort.returnDesc" },
];

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  facet: ProductFacet;
  facets: ProductFacetCounts;
  onFacetChange: (f: ProductFacet) => void;
  sort: ProductSortKey;
  dir: SortDirection;
  onSortChange: (key: ProductSortKey, dir: SortDirection) => void;
  visibleColumns: string[];
  onColumnsChange: (cols: string[]) => void;
}

const FILTER_ORDER: ProductFacet[] = [...PRODUCT_FACETS];

export function ProductsToolbar({
  search,
  onSearchChange,
  facet,
  facets,
  onFacetChange,
  sort,
  dir,
  onSortChange,
  visibleColumns,
  onColumnsChange,
}: Props) {
  const t = useTranslations("products");
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(search);

  // Keep the box in step when the URL changes from elsewhere (chip clear,
  // back button) without fighting the user mid-typing.
  useEffect(() => {
    setLocal(search);
  }, [search]);

  // Debounced into the parent, which owns the URL and therefore the SWR key.
  useEffect(() => {
    if (local === search) return;
    const timer = setTimeout(() => onSearchChange(local.trim()), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  // "/" focuses search, matching the orders console.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (el instanceof HTMLSelectElement) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const activePreset = SORT_PRESETS.find((p) => p.key === sort && p.dir === dir);
  const sortLabel = activePreset ? t(activePreset.labelKey) : t(`table.${columnLabelKey(sort)}`);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[210px] max-w-[540px] flex-1 basis-[320px]">
        <Search
          size={16}
          strokeWidth={2}
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted"
          style={{ insetInlineStart: 14 }}
        />
        <input
          ref={inputRef}
          type="search"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder={t("filters.search.placeholder")}
          aria-label={t("filters.search.placeholder")}
          className="h-11 w-full rounded-[11px] border border-line bg-surface-card text-[14px] text-ink-primary outline-none transition-colors duration-fast placeholder:font-normal placeholder:text-ink-muted focus:border-prod-pos"
          style={{ paddingInlineStart: 40, paddingInlineEnd: 46 }}
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-[5px] border border-line-subtle bg-surface-sunken px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-muted"
          style={{ insetInlineEnd: 12 }}
        >
          /
        </kbd>
      </div>

      <span className="min-w-0 flex-1 basis-2" />

      <Popover
        align="end"
        panelClassName="min-w-[250px] p-1.5"
        trigger={
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface-card px-[15px] text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken"
          >
            <ListFilter size={15} strokeWidth={2} className="text-ink-secondary" aria-hidden />
            {t("filters.title")}
            {facet !== "all" && (
              <span className="inline-grid h-5 min-w-5 place-items-center rounded-pill bg-prod-brand px-1.5 text-[11px] font-bold tabular-nums text-white">
                1
              </span>
            )}
          </button>
        }
      >
        {(close) => (
          <>
            <p className="m-0 px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t("filters.title")}
            </p>
            {FILTER_ORDER.filter((f) => facets[f] !== undefined).map((f) => (
              <button
                key={f}
                type="button"
                aria-current={facet === f}
                onClick={() => {
                  onFacetChange(f);
                  close();
                }}
                className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-start text-[13.5px] transition-colors duration-fast ${
                  facet === f
                    ? "bg-prod-brand-tint font-semibold text-prod-brand"
                    : "text-ink-primary hover:bg-surface-sunken"
                }`}
              >
                {t(`filters.status.${f}`)}
                <span className="ms-auto text-[12px] tabular-nums text-ink-muted">
                  {facets[f]}
                </span>
              </button>
            ))}
          </>
        )}
      </Popover>

      <Popover
        align="end"
        panelClassName="min-w-[250px] p-1.5"
        trigger={
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface-card px-[15px] text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken"
          >
            <ArrowDownUp size={15} strokeWidth={2} className="text-ink-secondary" aria-hidden />
            {t("sort.label")} : {sortLabel}
            <ChevronDown size={14} strokeWidth={2.2} className="text-ink-muted" aria-hidden />
          </button>
        }
      >
        {(close) => (
          <>
            <p className="m-0 px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t("sort.label")}
            </p>
            {SORT_PRESETS.map((p) => (
              <button
                key={`${p.key}-${p.dir}`}
                type="button"
                aria-current={sort === p.key && dir === p.dir}
                onClick={() => {
                  onSortChange(p.key, p.dir);
                  close();
                }}
                className={`flex w-full items-center rounded-[9px] px-2.5 py-2 text-start text-[13.5px] transition-colors duration-fast ${
                  sort === p.key && dir === p.dir
                    ? "bg-prod-brand-tint font-semibold text-prod-brand"
                    : "text-ink-primary hover:bg-surface-sunken"
                }`}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </>
        )}
      </Popover>

      <Popover
        align="end"
        panelClassName="min-w-[250px] p-1.5 max-h-[420px] overflow-y-auto"
        trigger={
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface-card px-[15px] text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken"
          >
            <Columns3 size={15} strokeWidth={2} className="text-ink-secondary" aria-hidden />
            {t("columns.label")}
            <ChevronDown size={14} strokeWidth={2.2} className="text-ink-muted" aria-hidden />
          </button>
        }
      >
        {() => (
          <>
            <p className="m-0 px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t("columns.heading")}
            </p>
            {PRODUCT_COLUMNS.map((col) => {
              const on = visibleColumns.includes(col.key);
              return (
                <label
                  key={col.key}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] text-ink-primary ${
                    col.locked ? "opacity-60" : "cursor-pointer hover:bg-surface-sunken"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={col.locked}
                    onChange={() =>
                      onColumnsChange(
                        on
                          ? visibleColumns.filter((k) => k !== col.key)
                          : // Re-derive from PRODUCT_COLUMNS so a re-enabled
                            // column returns to its canonical position rather
                            // than the end of the list.
                            PRODUCT_COLUMNS.filter(
                              (c) => visibleColumns.includes(c.key) || c.key === col.key,
                            ).map((c) => c.key),
                      )
                    }
                    className="h-3.5 w-3.5 flex-none cursor-pointer accent-prod-brand"
                  />
                  {t(col.labelKey)}
                  {col.locked && (
                    <span className="ms-auto text-[12px] text-ink-muted">{t("columns.fixed")}</span>
                  )}
                </label>
              );
            })}
          </>
        )}
      </Popover>
    </div>
  );
}

function columnLabelKey(sort: ProductSortKey): string {
  const found = PRODUCT_COLUMNS.find((c) => c.sort === sort);
  return found ? found.labelKey.replace("table.", "") : "product";
}
