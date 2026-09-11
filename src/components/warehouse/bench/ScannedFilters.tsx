"use client";

import { useLocale, useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import type { ScannedFilter, ScannedFacets, ScannedSegment } from "@/lib/warehouse/scanned-filters";

/**
 * Narrowing the scanned list, on a phone or at a desk.
 *
 * One control row, shared, because the two surfaces answering the same question
 * differently is how the list ended up sorted two ways at once. The segments
 * carry their counts: a tab that hides how much it holds makes the agent tap it
 * to find out, which on a loading dock is a tap too many.
 */

/** Yellow and lime read as blank on a light ground without an edge. */
const FAINT = new Set(["#f9fc01", "#8fff00"]);

export function ScannedFilters({
  isLy,
  filter,
  facets,
  active,
  patch,
  clear,
}: {
  isLy: boolean;
  filter: ScannedFilter;
  facets: ScannedFacets;
  active: boolean;
  patch: (next: Partial<ScannedFilter>) => void;
  clear: () => void;
}) {
  const t = useTranslations("warehouse.scanned.filters");
  const locale = useLocale();

  const segments: Array<{ key: ScannedSegment; label: string; count: number; tone?: "warn" }> = [
    { key: "all", label: t("all"), count: facets.segments.all },
    { key: "check", label: t("check"), count: facets.segments.check, tone: "warn" },
    { key: "waiting", label: t("waiting"), count: facets.segments.waiting },
    { key: "handed", label: t("handed"), count: facets.segments.handed },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={t("all")}
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {segments.map((s) => {
          const on = filter.seg === s.key;
          // A segment that holds nothing stays visible but recedes: its absence
          // would read as "no such state", which is a different fact.
          const empty = s.count === 0 && !on;
          return (
            <button
              key={s.key}
              type="button"
              data-testid="wh-scanned-seg"
              data-key={s.key}
              aria-pressed={on}
              onClick={() => patch({ seg: s.key })}
              className={[
                "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[12px] border px-3 text-[14px] font-semibold",
                on
                  ? "border-wm-accent bg-wm-accent-soft text-wm-ink"
                  : s.tone === "warn" && s.count > 0
                    ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
                    : "border-wm-card-edge bg-wm-card text-wm-ink",
                empty ? "opacity-45" : "",
              ].join(" ")}
            >
              {s.label}
              <b className="tabular-nums">{s.count}</b>
            </button>
          );
        })}
      </div>

      <label className="flex min-h-[44px] items-center gap-2.5 rounded-[12px] border border-wm-card-edge bg-wm-card px-3">
        <Search size={16} className="shrink-0 text-wm-ink-3" aria-hidden="true" />
        <input
          type="search"
          value={filter.q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder={t("search")}
          aria-label={t("search")}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-wm-ink outline-none placeholder:text-wm-ink-3"
        />
      </label>

      {isLy ? (
        <div
          role="group"
          aria-label={t("roll")}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <RollChip label={t("allRolls")} on={filter.hex === null} onClick={() => patch({ hex: null })} />
          {DARB_ZONE_ORDER.filter((hex) => (facets.rolls[hex] ?? 0) > 0).map((hex) => (
            <RollChip
              key={hex}
              hex={hex}
              label={zoneLabels(hex, locale).colour ?? hex}
              count={facets.rolls[hex]}
              on={filter.hex === hex}
              onClick={() => patch({ hex: filter.hex === hex ? null : hex })}
            />
          ))}
          {facets.unknownRoll > 0 ? (
            <RollChip
              label={zoneLabels(null, locale).colour ?? "?"}
              unknown
              count={facets.unknownRoll}
              on={filter.hex === "unknown"}
              onClick={() => patch({ hex: filter.hex === "unknown" ? null : "unknown" })}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {facets.products.length > 1 ? (
          <Picker
            label={t("product")}
            all={t("allProducts")}
            value={filter.product}
            options={facets.products}
            onPick={(v) => patch({ product: v })}
          />
        ) : null}
        {facets.scanners.length > 1 ? (
          <Picker
            label={t("scanner")}
            all={t("allScanners")}
            value={filter.who}
            options={facets.scanners}
            onPick={(v) => patch({ who: v })}
          />
        ) : null}
        {active ? (
          <button
            type="button"
            data-testid="wh-scanned-clear"
            onClick={clear}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-pill border border-wm-card-edge px-3 text-[13px] font-semibold text-wm-ink-2"
          >
            <X size={13} aria-hidden="true" />
            {t("clear")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RollChip({
  hex, label, count, on, unknown, onClick,
}: {
  hex?: string;
  label: string;
  count?: number;
  on: boolean;
  unknown?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="wh-scanned-roll"
      data-key={hex ?? (unknown ? "unknown" : "all")}
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-[12px] border px-3 text-[14px] font-semibold text-wm-ink ${
        on ? "border-wm-accent bg-wm-accent-soft" : "border-wm-card-edge bg-wm-card"
      }`}
    >
      {hex ? (
        <span
          aria-hidden="true"
          className={`h-[18px] w-[18px] shrink-0 rounded-[5px] ${FAINT.has(hex) ? "ring-1 ring-inset ring-wm-ink" : ""}`}
          style={{ background: hex }}
        />
      ) : unknown ? (
        <span aria-hidden="true" className="h-[18px] w-[18px] shrink-0 rounded-[5px] border-2 border-dashed border-wm-ink-3" />
      ) : null}
      <span className="truncate">{label}</span>
      {typeof count === "number" ? <b className="tabular-nums">{count}</b> : null}
    </button>
  );
}

/** A native select: one tap, the OS list, no popover to trap focus on a phone. */
function Picker({
  label, all, value, options, onPick,
}: {
  label: string;
  all: string;
  value: string | null;
  options: string[];
  onPick: (value: string | null) => void;
}) {
  return (
    <label className="inline-flex min-h-[36px] items-center gap-1.5 rounded-pill border border-wm-card-edge bg-wm-card px-3 text-[13px] text-wm-ink-2">
      <span className="shrink-0">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label={label}
        className="max-w-[140px] truncate bg-transparent text-[13px] font-semibold text-wm-ink outline-none"
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
