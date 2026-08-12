"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import type { OrderListFilters } from "@/lib/orders/list-filters";
import type { OrderStatus } from "@/types/order-status";
import { ProductAvatar } from "./ProductAvatar";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { CarrierMark } from "@/components/shared/CarrierMark";

/**
 * Instant facet bar — one row, every filter named.
 *
 * What it replaces hid status, agent, city, product and price behind a drawer
 * labelled "Avancé", with nothing on the closed bar to say what was applied.
 * Here one click applies, each menu states its own combination rule, and
 * active values surface as removable chips.
 *
 * The schema carries a single `status` enum spanning both phases of an order's
 * life. An operator does not think that way: "did the customer say yes" and
 * "where is the parcel" are separate questions. `Appel` and `Livraison` write
 * to the same field but each offers only its own phase, so one enum reads as
 * the two axes it actually represents.
 */

/** An option may carry a leading visual — a product photo, an agent avatar,
 *  a carrier mark. Recognition is faster than reading, especially in a list
 *  of Arabic product names that share a prefix. */
export interface FacetOption {
  value: string;
  label: string;
  selected: boolean;
  icon?: React.ReactNode;
}

interface AgentLike {
  id: string;
  full_name: string;
}
interface ProductLike {
  id: string;
  name: string;
  image_url?: string | null;
}
interface CarrierLike {
  id: string;
  name: string;
}

interface Props {
  filters: OrderListFilters;
  onChange: (patch: Partial<OrderListFilters>) => void;
  agents: AgentLike[];
  products: ProductLike[];
  carriers: CarrierLike[];
  cities: string[];
  /**
   * How many orders the filters match in total — served by the list API, not
   * counted from the loaded rows.
   *
   * It used to be `rows.length`, which meant a page size of 10 capped the
   * summary at "10 affichées" however many orders actually matched. The number
   * moved with the pagination control, so it answered a question nobody asks.
   *
   * `null` while the first page is in flight.
   */
  resultCount: number | null;
  /** Option lists still in flight, so their menus can say so. */
  loading?: { products?: boolean; carriers?: boolean; cities?: boolean };
}

const CALL_STATUSES = [
  "pending",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "rejected",
  "cancelled",
];

const DELIVERY_STATUSES = [
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
  "to_be_returned",
];

const DATE_RANGES = ["today", "d3", "d7", "d30"] as const;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const rangeDays = (key: string) => (key === "today" ? 0 : Number(key.slice(1)));

export function OrdersFacetBar({
  filters,
  onChange,
  agents,
  products,
  carriers,
  cities,
  resultCount,
  loading,
}: Props) {
  const t = useTranslations("orders");
  const tf = useTranslations("orders.facets");
  const tStatus = useTranslations("orders.statuses");
  const locale = useLocale();
  const nf = useMemo(
    () => new Intl.NumberFormat(locale === "ar" ? "ar" : "fr-FR"),
    [locale],
  );
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const label = (s: string) => {
    try {
      return tStatus(s);
    } catch {
      return s;
    }
  };
  const toggle = (id: string) => setOpen(open === id ? null : id);

  /** OR within a facet: picking a second value widens the set. */
  const toggleStatus = (value: string) => {
    const next = filters.statuses.includes(value as OrderStatus)
      ? filters.statuses.filter((s) => s !== value)
      : [...filters.statuses, value as OrderStatus];
    onChange({ statuses: next });
  };

  const activeCall = filters.statuses.filter((s) => CALL_STATUSES.includes(s)).length;
  const activeDelivery = filters.statuses.filter((s) => DELIVERY_STATUSES.includes(s)).length;
  const dateActive = filters.dateFrom || filters.dateTo ? 1 : 0;

  const applyRange = (key: string) => {
    const from = isoDaysAgo(rangeDays(key));
    onChange(
      filters.dateFrom === from
        ? { dateFrom: null, dateTo: null }
        : { dateFrom: from, dateTo: null },
    );
  };

  const chips: { key: string; label: string; clear: Partial<OrderListFilters> }[] = [];
  for (const s of filters.statuses) {
    chips.push({
      key: `s-${s}`,
      label: label(s),
      clear: { statuses: filters.statuses.filter((x) => x !== s) },
    });
  }
  if (filters.agentId) {
    chips.push({
      key: "agent",
      label:
        filters.agentId === "unassigned"
          ? tf("unassigned")
          : agents.find((a) => a.id === filters.agentId)?.full_name ?? filters.agentId,
      clear: { agentId: null },
    });
  }
  if (filters.city) chips.push({ key: "city", label: filters.city, clear: { city: "" } });
  if (filters.productId) {
    chips.push({
      key: "product",
      label: products.find((p) => p.id === filters.productId)?.name ?? filters.productId,
      clear: { productId: null },
    });
  }
  if (filters.carrierId) {
    chips.push({
      key: "carrier",
      label: carriers.find((c) => c.id === filters.carrierId)?.name ?? filters.carrierId,
      clear: { carrierId: null },
    });
  }
  if (dateActive) {
    chips.push({
      key: "date",
      label: `${filters.dateFrom ?? "…"} → ${filters.dateTo ?? "…"}`,
      clear: { dateFrom: null, dateTo: null },
    });
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
    <div ref={ref} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Facet
          label={tf("call")}
          count={activeCall}
          open={open === "call"}
          onToggle={() => toggle("call")}
          logic={tf("anyOf")}
          options={CALL_STATUSES.map((s) => ({
            value: s,
            label: label(s),
            selected: filters.statuses.includes(s as OrderStatus),
          }))}
          onSelect={toggleStatus}
        />
        <Facet
          label={tf("delivery")}
          count={activeDelivery}
          open={open === "delivery"}
          onToggle={() => toggle("delivery")}
          logic={tf("anyOf")}
          options={DELIVERY_STATUSES.map((s) => ({
            value: s,
            label: label(s),
            selected: filters.statuses.includes(s as OrderStatus),
          }))}
          onSelect={toggleStatus}
        />
        <Facet
          label={t("filters.agent")}
          count={filters.agentId ? 1 : 0}
          open={open === "agent"}
          onToggle={() => toggle("agent")}
          logic={tf("anyOf")}
          searchable
          options={[
            {
              value: "unassigned",
              label: tf("unassigned"),
              selected: filters.agentId === "unassigned",
              icon: <AgentAvatar name={null} size={20} />,
            },
            ...agents.map((a) => ({
              value: a.id,
              label: a.full_name,
              selected: filters.agentId === a.id,
              icon: <AgentAvatar name={a.full_name} size={20} />,
            })),
          ]}
          onSelect={(v) => onChange({ agentId: filters.agentId === v ? null : v })}
        />
        <Facet
          label={tf("date")}
          count={dateActive}
          open={open === "date"}
          onToggle={() => toggle("date")}
          logic={tf("onePeriod")}
          options={DATE_RANGES.map((r) => ({
            value: r,
            label: tf(r),
            selected: filters.dateFrom === isoDaysAgo(rangeDays(r)),
          }))}
          onSelect={applyRange}
        />
        <Facet
          label={t("columns.city")}
          count={filters.city ? 1 : 0}
          open={open === "city"}
          onToggle={() => toggle("city")}
          logic={tf("anyOfF")}
          searchable
          loading={loading?.cities}
          options={cities.map((c) => ({ value: c, label: c, selected: filters.city === c }))}
          onSelect={(v) => onChange({ city: filters.city === v ? "" : v })}
        />
        <Facet
          label={tf("product")}
          count={filters.productId ? 1 : 0}
          open={open === "product"}
          onToggle={() => toggle("product")}
          logic={tf("anyProduct")}
          searchable
          loading={loading?.products}
          options={products.map((p) => ({
            value: p.id,
            label: p.name,
            selected: filters.productId === p.id,
            icon: <ProductAvatar imageUrl={p.image_url ?? null} productName={p.name} size={20} />,
          }))}
          onSelect={(v) => onChange({ productId: filters.productId === v ? null : v })}
        />

        <Facet
          label={tf("carrier")}
          count={filters.carrierId ? 1 : 0}
          open={open === "carrier"}
          onToggle={() => toggle("carrier")}
          logic={tf("anyOf")}
          loading={loading?.carriers}
          options={carriers.map((c) => ({
            value: c.id,
            label: c.name,
            selected: filters.carrierId === c.id,
            icon: <CarrierMark name={c.name} size={20} />,
          }))}
          onSelect={(v) => onChange({ carrierId: filters.carrierId === v ? null : v })}
        />

        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-oms-border bg-oms-surface px-3 text-[13px] font-medium text-oms-ink-2 transition-colors duration-fast hover:border-oms-border-strong hover:text-oms-ink-1">
          <input
            type="checkbox"
            checked={filters.includeDeleted}
            onChange={(e) => onChange({ includeDeleted: e.target.checked })}
            className="h-3.5 w-3.5 cursor-pointer accent-brand"
          />
          {tf("showDeleted")}
        </label>
      </div>

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
            className="px-1.5 text-[12px] font-semibold text-brand hover:underline"
          >
            {tf("clearAll")}
          </button>
        </div>
      )}

      <div
        data-testid="result-summary"
        aria-live="polite"
        className="flex items-baseline gap-2 border-b border-oms-border pb-2 text-[13px]"
      >
        {resultCount === null ? (
          // Nothing, not a zero: page 1 is still in flight and "0 commandes"
          // for a beat reads as "your filter matched nothing".
          <span aria-hidden className="h-[17px] w-24 rounded-pill bg-oms-sunken" />
        ) : (
          <span className="font-semibold tabular-nums text-oms-ink-1">
            {tf("results", { count: nf.format(resultCount) })}
          </span>
        )}
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
  loading,
  options,
  onSelect,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  logic: string;
  searchable?: boolean;
  /** Options are still being fetched — "none" would be a lie meanwhile. */
  loading?: boolean;
  options: FacetOption[];
  onSelect: (value: string) => void;
}) {
  const tf = useTranslations("orders.facets");
  const [q, setQ] = useState("");
  const visible = q.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  /**
   * What is selected, said in words when there is one thing to say.
   *
   * A bare "1" badge told you a facet was active but not what it was set to,
   * so reading the bar meant opening every lit control in turn. One selection
   * names itself; several stay a count, because five status names do not fit
   * on a chip.
   */
  const selectedLabels = options.filter((o) => o.selected).map((o) => o.label);
  const value = selectedLabels.length === 1 ? selectedLabels[0] : null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
        className={
          "inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-lg border ps-3 pe-2.5 text-[13px] font-medium transition-colors duration-fast " +
          (count > 0
            ? "border-brand bg-brand-bg text-brand-hover"
            : "border-oms-border bg-oms-surface text-oms-ink-2 hover:border-oms-border-strong hover:text-oms-ink-1")
        }
      >
        <span className="flex-none">{label}</span>
        {value ? (
          <>
            <span aria-hidden className="flex-none opacity-40">
              ·
            </span>
            <span className="min-w-0 truncate font-semibold">{value}</span>
          </>
        ) : (
          count > 0 && (
            <span className="grid h-[16px] min-w-[16px] flex-none place-items-center rounded-pill bg-brand px-1 text-[10.5px] font-semibold tabular-nums text-white">
              {count}
            </span>
          )
        )}
        <ChevronDown size={12} strokeWidth={2} aria-hidden className="flex-none" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute start-0 top-[calc(100%+6px)] z-30 w-[248px] overflow-hidden rounded-card border border-oms-border bg-oms-surface shadow-floating"
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
                className="h-[30px] w-full rounded-md border border-oms-border bg-oms-sunken px-2 text-[12.5px] outline-none focus:border-brand focus:bg-oms-surface"
              />
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto p-1.5">
            {loading && options.length === 0 ? (
              // Three bars, not the word "Aucun résultat" — an empty menu while
              // the fetch is still in flight reads as "this market has no
              // products", which is a different and wrong answer.
              <div aria-busy="true" className="flex flex-col gap-1.5 p-1.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-6 rounded-md bg-oms-sunken" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-oms-ink-3">{tf("none")}</p>
            ) : (
              visible.map((o) => (
                <Option
                  key={o.value}
                  selected={o.selected}
                  onSelect={() => onSelect(o.value)}
                  label={o.label}
                  icon={o.icon}
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
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  icon?: React.ReactNode;
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
          (selected ? "border-brand bg-brand" : "border-oms-border-strong")
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
      {icon}
      <span dir="auto" className="min-w-0 truncate">
        {label}
      </span>
    </button>
  );
}
