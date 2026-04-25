"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

interface SearchSpec {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel?: string;
}

interface Props {
  search?: SearchSpec;
  chips: FilterChip[];
  actions?: ReactNode;
}

export function WarehouseFilterBar({ search, chips, actions }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {search ? (
        <div className="relative">
          <Search
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-secondary pointer-events-none"
          />
          <input
            type="text"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.ariaLabel ?? search.placeholder}
            className="h-8 ps-8 pe-3 text-[13px] bg-surface-card border border-line rounded-md text-ink-primary placeholder:text-ink-secondary min-w-[240px]"
          />
        </div>
      ) : null}

      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1.5 h-8 ps-2.5 pe-1 text-[12px] font-medium bg-surface-card border border-line-subtle rounded-pill text-ink-primary"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove ${chip.label}`}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-ink-secondary hover:bg-surface-hover hover:text-ink-primary transition-colors duration-fast"
          >
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        </span>
      ))}

      {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
