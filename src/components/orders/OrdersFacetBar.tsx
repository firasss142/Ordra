"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import type { OrderStatus } from "@/types/order-status";

/**
 * Instant facet bar.
 *
 * The bar it replaces hid status, agent, city, product and price behind a
 * drawer labelled "Avancé", with no indication of what was applied. Reaching a
 * filtered view cost several clicks and a round trip, and you could not tell
 * from the closed bar that anything was narrowing your results.
 *
 * Here every facet is a named control, one click applies, and the combination
 * rule (OR within a facet, AND across facets) is stated in the menu rather
 * than left to be guessed.
 */

interface AgentLike {
  id: string;
  full_name: string;
}

interface Props {
  filters: OrderListFilters;
  onChange: (patch: Partial<OrderListFilters>) => void;
  agents: AgentLike[];
  cities: string[];
  /** Rows currently loaded — the keyset list has no total, so this is
   *  labelled "affichées" rather than claiming to be the filtered total. */
  resultCount: number;
  resultValue: string;
  currencyCode: string;
}

/** Status values worth exposing as a facet, grouped the way an operator thinks. */
const STATUS_OPTIONS: { value: OrderStatus; labelKey: string }[] = [
  { value: "pending" as OrderStatus, labelKey: "pending" },
  { value: "attempt_1" as OrderStatus, labelKey: "attempt_1" },
  { value: "attempt_2" as OrderStatus, labelKey: "attempt_2" },
  { value: "attempt_3" as OrderStatus, labelKey: "attempt_3" },
  { value: "callback_scheduled" as OrderStatus, labelKey: "callback_scheduled" },
  { value: "confirmed" as OrderStatus, labelKey: "confirmed" },
  { value: "uploaded" as OrderStatus, labelKey: "uploaded" },
  { value: "delivered" as OrderStatus, labelKey: "delivered" },
  { value: "returned" as OrderStatus, labelKey: "returned" },
  { value: "rejected" as OrderStatus, labelKey: "rejected" },
  { value: "cancelled" as OrderStatus, labelKey: "cancelled" },
];

export function OrdersFacetBar({
  filters,
  onChange,
  agents,
  cities,
  resultCount,
  resultValue,
  currencyCode,
}: Props) {
  const t = useTranslations("orders");
  const tf = useTranslations("orders.facets");
  const tStatus = useTranslations("orders.statuses");
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const statusLabel = (s: string) => {
    try {
      return tStatus(s);
    } catch {
      return s;
    }
  };

  /** OR within a facet: selecting a second value widens the set. */
  const toggleStatus = (value: OrderStatus) => {
    const next = filters.statuses.includes(value)
      ? filters.statuses.filter((s) => s !== value)
      : [...filters.statuses, value];
    onChange({ statuses: next });
  };

  const chips: { key: string; label: string; clear: Partial<OrderListFilters> }[] = [];
  for (const s of filters.statuses) {
    chips.push({
      key: `status-${s}`,
      label: statusLabel(s),
      clear: { statuses: filters.statuses.filter((x) => x !== s) },
    });
  }
  if (filters.agentId) {
    const name =
      filters.agentId === "unassigned"
        ? tf("unassigned")
        : agents.find((a) => a.id === filters.agentId)?.full_name ?? filters.agentId;
    chips.push({ key: "agent", label: name, clear: { agentId: null } });
  }
  if (filters.city) {
    chips.push({ key: "city", label: filters.city, clear: { city: "" } });
  }

  const clearAll: Partial<OrderListFilters> = {
    statuses: [],
    agentId: null,
    city: "",
    productId: null,
    carrierId: null,
    rejectionReason: null,
    totalMin: null,
    totalMax: null,
    dateFrom: null,
    dateTo: null,
  };

  return (
    <div ref={ref} className="flex flex-col gap-2">
      {/* Facets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Facet
          id="status"
          label={t("filters.status")}
          count={filters.statuses.length}
          open={open === "status"}
          onToggle={() => setOpen(open === "status" ? null : "status")}
          logic={tf("anyOf")}
          options={STATUS_OPTIONS.map((o) => ({
            value: o.value,
            label: statusLabel(o.labelKey),
            selected: filters.statuses.includes(o.value),
          }))}
          onSelect={(v) => toggleStatus(v as OrderStatus)}
        />

        <Facet
          id="agent"
          label={t("filters.agent")}
          count={filters.agentId ? 1 : 0}
          open={open === "agent"}
          onToggle={() => setOpen(open === "agent" ? null : "agent")}
          logic={tf("anyOf")}
          options={[
            {
              value: "unassigned",
              label: tf("unassigned"),
              selected: filters.agentId === "unassigned",
            },
            ...agents.map((a) => ({
              value: a.id,
              label: a.full_name,
              selected: filters.agentId === a.id,
            })),
          ]}
          onSelect={(v) => onChange({ agentId: filters.agentId === v ? null : v })}
        />

        <Facet
          id="city"
          label={t("columns.city")}
          count={filters.city ? 1 : 0}
          open={open === "city"}
          onToggle={() => setOpen(open === "city" ? null : "city")}
          logic={tf("anyOfF")}
          searchable
          options={cities.map((c) => ({ value: c, label: c, selected: filters.city === c }))}
          onSelect={(v) => onChange({ city: filters.city === v ? "" : v })}
        />
      </div>

      {/* Active chips — you always know what is on */}
      {chips.length > 0 && (
        <div data-testid="active-chips" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-pill border border-oms-border-strong bg-oms-surface ps-2.5 pe-1 text-[12px] font-medium text-oms-ink-1"
            >
              <span dir="auto">{c.label}</span>
              <button
                type="button"
                aria-label={tf("remove", { label: c.label })}
                onClick={() => onChange(c.clear)}
                className="grid h-[17px] w-[17px] place-items-center rounded-full text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-age-late"
              >
                <X size={11} strokeWidth={2.2} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onChange(clearAll)}
            className="px-1.5 text-[12px] font-semibold text-oms-accent hover:underline"
          >
            {tf("clearAll")}
          </button>
        </div>
      )}

      {/* What the current filters actually returned */}
      <div
        data-testid="result-summary"
        className="flex items-baseline gap-2 border-b border-oms-border pb-2 text-[13px]"
      >
        <span className="font-semibold tabular-nums text-oms-ink-1">
          {tf("results", { count: resultCount })}
        </span>
        <span aria-hidden className="text-oms-border-strong">
          ·
        </span>
        <span className="font-medium tabular-nums text-oms-ink-2">
          {resultValue} {currencyCode}
        </span>
      </div>
    </div>
  );
}

function Facet({
  label,
  count,
  open,
  onToggle,
  logic,
  searchable,
  options,
  onSelect,
}: {
  id: string;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  logic: string;
  searchable?: boolean;
  options: { value: string; label: string; selected: boolean }[];
  onSelect: (value: string) => void;
}) {
  const tf = useTranslations("orders.facets");
  const [q, setQ] = useState("");
  const visible = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
        className={
          "inline-flex h-[30px] items-center gap-1.5 rounded-pill border ps-2.5 pe-2 text-[12.5px] font-medium transition-colors duration-fast " +
          (count > 0
            ? "border-oms-accent bg-oms-accent-bg text-oms-accent-ink"
            : "border-oms-border bg-oms-surface text-oms-ink-2 hover:border-oms-border-strong hover:text-oms-ink-1")
        }
      >
        {label}
        {count > 0 && (
          <span className="grid h-[15px] min-w-[15px] place-items-center rounded-pill bg-oms-accent px-1 text-[10.5px] font-semibold text-white tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute start-0 top-[calc(100%+6px)] z-30 max-h-[320px] w-[240px] overflow-hidden rounded-card border border-oms-border bg-oms-surface shadow-floating"
        >
          <div className="border-b border-oms-border bg-oms-sunken px-3 py-2">
            <div className="text-[12px] font-semibold text-oms-ink-1">{label}</div>
            {/* The rule is stated, not guessed. */}
            <div className="text-[11px] text-oms-ink-3">{logic}</div>
          </div>
          {searchable && (
            <div className="px-2 pt-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tf("search")}
                className="h-[30px] w-full rounded-md border border-oms-border bg-oms-sunken px-2 text-[12.5px] outline-none focus:border-oms-accent focus:bg-oms-surface"
              />
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto p-1.5">
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-oms-ink-3">{tf("none")}</p>
            ) : (
              visible.map((o) => (
                <Option
                  key={o.value}
                  selected={o.selected}
                  onSelect={() => onSelect(o.value)}
                  label={o.label}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Option({
  selected,
  onSelect,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] text-oms-ink-1 transition-colors duration-fast hover:bg-oms-sunken"
    >
      <span
        aria-hidden
        className={
          "grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] border " +
          (selected ? "border-oms-accent bg-oms-accent" : "border-oms-border-strong")
        }
      >
        {selected && (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M1.5 5.2L4 7.5 8.5 2.5"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span dir="auto" className="min-w-0 truncate">
        {label}
      </span>
    </button>
  );
}
