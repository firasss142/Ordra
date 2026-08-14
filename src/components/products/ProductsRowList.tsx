"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronDown,
  LayoutGrid,
  PackageSearch,
  Search,
} from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { Pagination } from "@/components/shared/Pagination";
import {
  PRODUCT_PAGE_SIZES,
  PRODUCT_SORT_KEYS,
  type ProductFacet,
  type ProductFacetCounts,
  type ProductListPagination,
  type ProductListRow,
  type ProductSortKey,
  type SortDirection,
} from "@/types/product-list";
import { ProductRow, type RowDensity } from "./ProductRow";

const DENSITY_STORAGE_KEY = "oms:products:density";

/**
 * All eight server facets, in one strip of pills.
 *
 * This strip replaces BOTH surfaces the old console had — the five-tile
 * "attention requise" bar and the eight-entry filter popover — which exposed
 * different subsets of the same thing. A non-empty exception facet carries its
 * status tint AT REST, which is what makes the bar redundant: the red is the
 * alert.
 */
const FACET_CHIPS: { facet: ProductFacet; labelKey: string; tone?: "bad" | "warn" }[] = [
  { facet: "all", labelKey: "filters.status.all" },
  { facet: "active", labelKey: "filters.status.active" },
  { facet: "outOfStock", labelKey: "facets.outOfStock", tone: "bad" },
  { facet: "lowStock", labelKey: "facets.lowStock", tone: "warn" },
  { facet: "losingMoney", labelKey: "facets.losingMoney", tone: "bad" },
  { facet: "thinMargin", labelKey: "filters.status.thinMargin", tone: "warn" },
  { facet: "noSales", labelKey: "facets.noSales", tone: "warn" },
  { facet: "inactive", labelKey: "facets.inactive" },
];

/**
 * Every sort key stays reachable. The old console had two sort surfaces — six
 * named presets plus the column headers — and rows have no headers, so the menu
 * must carry all eleven or `current_stock`, `unit_cogs`, `confirmation_rate`,
 * `delivery_rate`, `total_leads` and `is_active` become unsortable.
 */
const SORT_LABEL_KEYS: Record<ProductSortKey, string> = {
  name: "rowList.sortKeys.name",
  current_stock: "rowList.sortKeys.currentStock",
  unit_cogs: "rowList.sortKeys.unitCogs",
  revenue: "rowList.sortKeys.revenue",
  net_profit: "rowList.sortKeys.netProfit",
  margin_pct: "rowList.sortKeys.marginPct",
  confirmation_rate: "rowList.sortKeys.confirmationRate",
  delivery_rate: "rowList.sortKeys.deliveryRate",
  return_rate: "rowList.sortKeys.returnRate",
  total_leads: "rowList.sortKeys.totalLeads",
  is_active: "rowList.sortKeys.isActive",
};

interface Props {
  rows: ProductListRow[];
  facets: ProductFacetCounts;
  facet: ProductFacet;
  onFacetChange: (f: ProductFacet) => void;
  search: string;
  onSearchChange: (q: string) => void;
  sort: ProductSortKey;
  dir: SortDirection;
  onSortChange: (key: ProductSortKey, dir: SortDirection) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  onArchive: (id: string, name: string) => void;
  canManage: boolean;
  canToggleActive: boolean;
  canArchive: boolean;
  locale: string;
  currency: string;
  loading: boolean;
  periodLabel: string;
  pagination: ProductListPagination | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange: (n: number) => void;
  bulkBar?: React.ReactNode;
}

const CONTROL =
  "inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-surface-card px-[13px] text-[13px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken";

export function ProductsRowList({
  rows,
  facets,
  facet,
  onFacetChange,
  search,
  onSearchChange,
  sort,
  dir,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onToggleActive,
  onAdjustStock,
  onArchive,
  canManage,
  canToggleActive,
  canArchive,
  locale,
  currency,
  loading,
  periodLabel,
  pagination,
  onPageChange,
  onPageSizeChange,
  bulkBar,
}: Props) {
  const t = useTranslations("products");
  const inputRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState(search);
  const [density, setDensity] = useState<RowDensity>("comfortable");

  // Keep the box in step when the URL changes from elsewhere (facet clear, back
  // button) without fighting the user mid-keystroke.
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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
      if (stored === "compact" || stored === "comfortable") setDensity(stored);
    } catch {
      // A corrupt or unavailable preference must not break the page.
    }
  }, []);

  const changeDensity = useCallback((next: RowDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Private browsing / quota — density just won't persist.
    }
  }, []);

  const pickSort = useCallback(
    (key: ProductSortKey) => {
      // Same key flips the direction; a new key starts on the reading most
      // people want — biggest first, except names.
      const nextDir: SortDirection =
        sort === key ? (dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
      onSortChange(key, nextDir);
    },
    [sort, dir, onSortChange],
  );

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const total = facets.all;
  const activeCount = facets.active;
  const DirIcon = dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <div className="flex flex-col gap-4">
      {/* ── toolbar, gathered into one card ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line-subtle bg-surface-card p-[11px_13px] shadow-hover-row">
        <div className="relative min-w-[230px] max-w-[400px] flex-1">
          <Search
            size={16}
            strokeWidth={2}
            aria-hidden
            className="pointer-events-none absolute start-[13px] top-1/2 -translate-y-1/2 text-ink-muted"
          />
          <input
            ref={inputRef}
            type="search"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder={t("filters.search.placeholder")}
            aria-label={t("filters.search.placeholder")}
            className="h-[42px] w-full rounded-[12px] border border-line bg-surface-card ps-10 pe-3.5 text-[14px] text-ink-primary outline-none transition-colors duration-fast placeholder:text-ink-muted hover:border-line-strong focus:border-prod-brand"
          />
        </div>

        <div role="group" aria-label={t("filters.title")} className="flex flex-wrap gap-[7px]">
          {FACET_CHIPS.filter((chip) => facets[chip.facet] !== undefined).map((chip) => {
            const count = facets[chip.facet] ?? 0;
            const on = facet === chip.facet;
            // A zero count is not actionable: "Rupture 0" used to open an empty
            // list dressed up as an affordance. "Tous" stays clickable — it is
            // the way back out.
            const empty = count === 0 && !on && chip.facet !== "all";
            // Tint at rest only when the exception actually has products in it.
            const toneAttr = chip.tone && count > 0 ? chip.tone : undefined;
            return (
              <button
                key={chip.facet}
                type="button"
                aria-pressed={on}
                data-tone={toneAttr}
                disabled={empty}
                onClick={() => onFacetChange(on ? "all" : chip.facet)}
                className={chipClass(toneAttr, on)}
              >
                {t(chip.labelKey)}
                <span className={chipCountClass(toneAttr, on)}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className="ms-auto flex gap-2">
          <Popover
            align="end"
            panelClassName="min-w-[250px] p-1.5"
            trigger={
              <button type="button" className={CONTROL}>
                <ArrowDownUp size={14} strokeWidth={2} className="text-ink-secondary" aria-hidden />
                {t("rowList.sortBy", { value: t(SORT_LABEL_KEYS[sort]) })}
                <DirIcon size={13} strokeWidth={2.4} className="text-ink-muted" aria-hidden />
              </button>
            }
          >
            {(close) => (
              <>
                <p className="m-0 px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  {t("sort.label")}
                </p>
                {PRODUCT_SORT_KEYS.map((key) => {
                  const on = sort === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-current={on}
                      onClick={() => {
                        pickSort(key);
                        close();
                      }}
                      className={`flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-start text-[13.5px] transition-colors duration-fast ${
                        on
                          ? "bg-prod-brand-tint font-semibold text-prod-brand"
                          : "text-ink-primary hover:bg-surface-sunken"
                      }`}
                    >
                      {t(SORT_LABEL_KEYS[key])}
                      {on && (
                        <DirIcon
                          size={13}
                          strokeWidth={2.4}
                          aria-label={dir === "asc" ? t("rowList.sortAscending") : t("rowList.sortDescending")}
                          className="ms-auto"
                        />
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </Popover>

          <Popover
            align="end"
            panelClassName="min-w-[190px] p-1.5"
            trigger={
              <button type="button" className={CONTROL}>
                <LayoutGrid size={14} strokeWidth={2} className="text-ink-secondary" aria-hidden />
                {t("rowList.density")}
                <ChevronDown size={13} strokeWidth={2.2} className="text-ink-muted" aria-hidden />
              </button>
            }
          >
            {(close) => (
              <>
                {(["comfortable", "compact"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-current={density === option}
                    onClick={() => {
                      changeDensity(option);
                      close();
                    }}
                    className={`flex w-full items-center rounded-[9px] px-2.5 py-2 text-start text-[13.5px] transition-colors duration-fast ${
                      density === option
                        ? "bg-prod-brand-tint font-semibold text-prod-brand"
                        : "text-ink-primary hover:bg-surface-sunken"
                    }`}
                  >
                    {option === "comfortable"
                      ? t("rowList.densityComfortable")
                      : t("rowList.densityCompact")}
                  </button>
                ))}
              </>
            )}
          </Popover>
        </div>
      </div>

      {/* ── list header: the select-all the table header used to carry ── */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[12.5px] text-ink-secondary">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={rows.length === 0}
          onChange={onToggleSelectAll}
          aria-label={t("table.selectAll")}
          className="h-[15px] w-[15px] cursor-pointer accent-prod-brand disabled:cursor-not-allowed disabled:opacity-40"
        />
        {total !== undefined && (
          <span className="tabular-nums">
            {t("rowList.summary", { count: total, active: activeCount ?? 0 })}
          </span>
        )}
        <span className="ms-auto tabular-nums text-ink-muted">
          {periodLabel}
        </span>
      </div>

      {bulkBar}

      {loading && rows.length === 0 ? (
        <div
          role="status"
          aria-label={t("table.loading")}
          className="flex flex-col gap-2.5"
          data-density={density}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`block animate-pulse rounded-[16px] bg-surface-sunken ${
                density === "compact" ? "h-[76px]" : "h-[104px]"
              }`}
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[16px] border border-line-subtle bg-surface-card px-6 py-[84px] text-center">
          <span className="grid h-[52px] w-[52px] place-items-center rounded-[15px] border border-line-subtle bg-surface-sunken text-ink-muted">
            <PackageSearch size={23} strokeWidth={1.8} aria-hidden />
          </span>
          <h4 className="m-0 text-[15px] font-semibold text-ink-primary">
            {search ? t("emptySearchTitle") : t("emptyState")}
          </h4>
          <p className="m-0 max-w-[40ch] text-[13.5px] leading-relaxed text-ink-secondary">
            {search ? t("noSearchMatch", { q: search }) : t("emptyStateHint")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5" data-density={density}>
          {rows.map((row) => (
            <ProductRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              onToggleSelect={onToggleSelect}
              onToggleActive={onToggleActive}
              onAdjustStock={onAdjustStock}
              onArchive={onArchive}
              canManage={canManage}
              canToggleActive={canToggleActive}
              canArchive={canArchive}
              locale={locale}
              currency={currency}
              density={density}
            />
          ))}
        </div>
      )}

      {pagination && (
        <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-surface-card">
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.limit}
            pageSizeOptions={[...PRODUCT_PAGE_SIZES]}
            totalItems={pagination.total}
            hasPrev={pagination.page > 1}
            hasNext={pagination.page < pagination.totalPages}
            // Server-computed, and the server clamps `page` to totalPages — the
            // client shows what came back, never what it asked for.
            rangeFrom={pagination.total === 0 ? undefined : pagination.rangeFrom}
            rangeTo={pagination.total === 0 ? undefined : pagination.rangeTo}
            onPrev={() => onPageChange(Math.max(1, pagination.page - 1))}
            onNext={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      )}
    </div>
  );
}

function chipClass(tone: "bad" | "warn" | undefined, on: boolean): string {
  const base =
    "group inline-flex h-[38px] items-center gap-2 rounded-pill border px-[15px] text-[13px] transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-45";
  if (on) {
    if (tone === "bad")
      return `${base} border-status-critical/35 bg-status-criticalBg font-semibold text-status-critical`;
    if (tone === "warn")
      return `${base} border-status-warning/40 bg-status-warningBg font-semibold text-status-warning`;
    return `${base} border-prod-brand-soft bg-prod-brand-tint font-semibold text-prod-brand`;
  }
  if (tone === "bad")
    return `${base} border-status-critical/30 bg-surface-card font-medium text-status-critical hover:border-status-critical/60`;
  if (tone === "warn")
    return `${base} border-status-warning/35 bg-surface-card font-medium text-status-warning hover:border-status-warning/60`;
  return `${base} border-line bg-surface-card font-medium text-ink-secondary hover:border-line-strong hover:text-ink-primary`;
}

function chipCountClass(tone: "bad" | "warn" | undefined, on: boolean): string {
  const base = "rounded-[6px] px-1.5 text-[11.5px] font-bold tabular-nums";
  // Pressed chips already sit on their tone's tint, so the badge inverts to the
  // card ground rather than disappearing into the pill.
  if (tone === "bad")
    return `${base} ${on ? "bg-surface-card" : "bg-status-criticalBg"} text-status-critical`;
  if (tone === "warn")
    return `${base} ${on ? "bg-surface-card" : "bg-status-warningBg"} text-status-warning`;
  if (on) return `${base} bg-prod-brand-soft text-prod-brand`;
  return `${base} bg-prod-neutral-bg text-ink-muted`;
}
