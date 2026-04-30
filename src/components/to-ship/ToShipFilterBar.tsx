"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Package, MapPin, Search, X } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { ToShipFilters } from "@/lib/to-ship/types";

export interface FilterOption {
  id: string;
  label: string;
  hint?: string;
}

interface ToShipFilterBarProps {
  filters: ToShipFilters;
  onChange: (next: ToShipFilters) => void;
  productOptions: FilterOption[];
  cityOptions: FilterOption[];
  labels: {
    label: string;
    product: string;
    city: string;
    all: string;
    clear: string;
    searchPlaceholder: string;
    noResults: string;
    activeCount: (n: number) => string;
  };
}

export function ToShipFilterBar({
  filters,
  onChange,
  productOptions,
  cityOptions,
  labels,
}: ToShipFilterBarProps) {
  const activeProduct = filters.productId
    ? productOptions.find((o) => o.id === filters.productId) ?? null
    : null;
  const activeCity = filters.city
    ? cityOptions.find((o) => o.id === filters.city) ?? null
    : null;
  const activeCount = (activeProduct ? 1 : 0) + (activeCity ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary pe-1">
        {labels.label}
        {activeCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill bg-ink-primary text-white text-[11px] font-semibold tabular-nums"
            aria-label={labels.activeCount(activeCount)}
          >
            {activeCount}
          </span>
        )}
      </span>

      <FilterChip
        icon={<Package size={13} strokeWidth={1.75} />}
        label={labels.product}
        value={activeProduct}
        options={productOptions}
        searchPlaceholder={labels.searchPlaceholder}
        noResultsLabel={labels.noResults}
        allLabel={labels.all}
        onSelect={(id) => onChange({ ...filters, productId: id })}
        onClear={() => onChange({ ...filters, productId: null })}
      />
      <FilterChip
        icon={<MapPin size={13} strokeWidth={1.75} />}
        label={labels.city}
        value={activeCity}
        options={cityOptions}
        searchPlaceholder={labels.searchPlaceholder}
        noResultsLabel={labels.noResults}
        allLabel={labels.all}
        onSelect={(id) => onChange({ ...filters, city: id })}
        onClear={() => onChange({ ...filters, city: null })}
      />

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange({ productId: null, city: null })}
          className="text-[12px] font-medium text-ink-secondary hover:text-ink-primary underline underline-offset-2 transition-colors duration-fast ms-1"
        >
          {labels.clear}
        </button>
      )}
    </div>
  );
}

interface FilterChipProps {
  icon: React.ReactNode;
  label: string;
  value: FilterOption | null;
  options: FilterOption[];
  searchPlaceholder: string;
  noResultsLabel: string;
  allLabel: string;
  onSelect: (id: string) => void;
  onClear: () => void;
}

function FilterChip({
  icon,
  label,
  value,
  options,
  searchPlaceholder,
  noResultsLabel,
  allLabel,
  onSelect,
  onClear,
}: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const isActive = value !== null;

  const trigger = (
    <button
      type="button"
      aria-label={label}
      className={[
        "inline-flex items-center gap-1.5 h-8 ps-2.5 pe-2 rounded-pill text-[13px] font-medium",
        "border transition-colors duration-fast",
        isActive
          ? "bg-ink-primary text-white border-ink-primary hover:bg-[#2A2A2A]"
          : "bg-surface-card text-ink-primary border-line hover:bg-surface-hover",
      ].join(" ")}
    >
      <span className={isActive ? "text-white" : "text-ink-secondary"}>{icon}</span>
      <span className="truncate max-w-[160px]">
        {isActive ? value!.label : label}
      </span>
      {isActive ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Clear ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onClear();
            }
          }}
          className="ms-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-white/20 transition-colors duration-fast cursor-pointer"
        >
          <X size={11} strokeWidth={2} />
        </span>
      ) : (
        <ChevronDownIcon />
      )}
    </button>
  );

  return (
    <Popover
      trigger={trigger}
      align="start"
      open={open}
      onOpenChange={setOpen}
      panelClassName="p-0 w-[260px] overflow-hidden"
    >
      {(close) => (
        <SearchableList
          options={options}
          activeId={value?.id ?? null}
          searchPlaceholder={searchPlaceholder}
          noResultsLabel={noResultsLabel}
          allLabel={allLabel}
          onPick={(id) => {
            if (id === null) onClear();
            else onSelect(id);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="opacity-60 ms-0.5"
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface SearchableListProps {
  options: FilterOption[];
  activeId: string | null;
  searchPlaceholder: string;
  noResultsLabel: string;
  allLabel: string;
  onPick: (id: string | null) => void;
}

function SearchableList({
  options,
  activeId,
  searchPlaceholder,
  noResultsLabel,
  allLabel,
  onPick,
}: SearchableListProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // total list = "All" row + filtered options
  const total = filtered.length + 1;

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Scroll highlighted item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-index="${highlight}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlight]);

  function commitIndex(i: number) {
    if (i === 0) onPick(null);
    else onPick(filtered[i - 1]?.id ?? null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitIndex(highlight);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="relative border-b border-line-subtle">
        <Search
          size={13}
          strokeWidth={1.75}
          className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full h-9 ps-8 pe-3 text-[13px] bg-surface-card text-ink-primary placeholder:text-ink-muted outline-none"
        />
      </div>
      <ul
        ref={listRef}
        role="listbox"
        className="max-h-[240px] overflow-y-auto py-1 m-0"
      >
        <Row
          index={0}
          label={allLabel}
          isActive={activeId === null}
          isHighlighted={highlight === 0}
          onMouseEnter={() => setHighlight(0)}
          onClick={() => commitIndex(0)}
          subtle
        />
        {filtered.length === 0 ? (
          <li className="px-3 py-3 text-[13px] text-ink-secondary text-center">
            {noResultsLabel}
          </li>
        ) : (
          filtered.map((o, i) => (
            <Row
              key={o.id}
              index={i + 1}
              label={o.label}
              hint={o.hint}
              isActive={activeId === o.id}
              isHighlighted={highlight === i + 1}
              onMouseEnter={() => setHighlight(i + 1)}
              onClick={() => commitIndex(i + 1)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function Row({
  index,
  label,
  hint,
  isActive,
  isHighlighted,
  onMouseEnter,
  onClick,
  subtle,
}: {
  index: number;
  label: string;
  hint?: string;
  isActive: boolean;
  isHighlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <li
      data-index={index}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "flex items-center gap-2 px-3 py-2 text-[13px] cursor-pointer",
        isHighlighted ? "bg-surface-selected" : "bg-transparent",
        subtle ? "text-ink-secondary" : "text-ink-primary",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="text-[11px] text-ink-muted tabular-nums">{hint}</span>
      )}
      {isActive && (
        <Check size={13} strokeWidth={2} className="text-status-success" aria-hidden />
      )}
    </li>
  );
}
