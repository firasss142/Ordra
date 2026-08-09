"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EyeOff, PackageX, PauseCircle, TrendingDown, TriangleAlert, X } from "lucide-react";
import type { ProductFacet, ProductFacetCounts } from "@/types/product-list";

interface Props {
  facets: ProductFacetCounts;
  active: ProductFacet;
  onChange: (facet: ProductFacet) => void;
  loading?: boolean;
}

type Tone = "critical" | "warning" | "action" | "neutral";

const TILES: { facet: ProductFacet; labelKey: string; tone: Tone }[] = [
  { facet: "outOfStock", labelKey: "facets.outOfStock", tone: "critical" },
  { facet: "lowStock", labelKey: "facets.lowStock", tone: "warning" },
  { facet: "losingMoney", labelKey: "facets.losingMoney", tone: "critical" },
  { facet: "noSales", labelKey: "facets.noSales", tone: "action" },
  { facet: "inactive", labelKey: "facets.inactive", tone: "neutral" },
];

const TONE: Record<Tone, { fg: string; chip: string }> = {
  critical: { fg: "text-status-critical", chip: "bg-status-criticalBg" },
  warning: { fg: "text-status-warning", chip: "bg-status-warningBg" },
  action: { fg: "text-status-action", chip: "bg-prod-info-bg" },
  neutral: { fg: "text-ink-secondary", chip: "bg-prod-neutral-bg" },
};

function icon(facet: ProductFacet) {
  const p = { size: 21, strokeWidth: 1.9 } as const;
  switch (facet) {
    case "outOfStock":
      return <PackageX {...p} />;
    case "lowStock":
      return <TriangleAlert {...p} />;
    case "losingMoney":
      return <TrendingDown {...p} />;
    case "noSales":
      return <EyeOff {...p} />;
    default:
      return <PauseCircle {...p} />;
  }
}

/**
 * The filter surface. Replaces the old status-pill row AND the inert
 * PortfolioStrip.
 *
 * Two deliberate information-design choices:
 *
 * 1. These recede a plane. Sunken ground, no border at rest, shorter than the
 *    KPI cards above. The original problem was two different card types at
 *    identical visual weight on adjacent rows, so the eye could not tell
 *    "figures you read" from "controls you press". The ACTIVE one lifts onto
 *    white with a coloured border — inactive recedes, active emerges.
 *
 * 2. A zero count is `disabled`. Clicking "Rupture 0" used to open an empty
 *    table, which is a dead end dressed up as an affordance.
 *
 * Every count comes straight from the endpoint's `facets`, which is computed by
 * the same predicate that produces the rows — so a tile's number always equals
 * the pagination total of the view it opens.
 */
export function ProductsExceptionBar({ facets, active, onChange, loading }: Props) {
  const t = useTranslations("products");

  const flagged = TILES.reduce((sum, tile) => sum + (facets[tile.facet] ?? 0), 0);
  const visible = TILES.filter((tile) => facets[tile.facet] !== undefined);

  if (loading && visible.length === 0) {
    return (
      <div className="flex flex-col gap-2.5">
        <span className="h-3 w-40 animate-pulse rounded-[4px] bg-surface-sunken" />
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-[50px] animate-pulse rounded-[12px] bg-surface-sunken" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-secondary">
          {t("facets.heading")}
        </span>
        <span className="text-[11.5px] tabular-nums text-ink-muted">
          {flagged > 0 ? t("facets.flagged", { count: flagged }) : t("facets.allClear")}
        </span>
        {active !== "all" && (
          <button
            type="button"
            onClick={() => onChange("all")}
            className="ms-auto rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium text-ink-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary"
          >
            {t("facets.showAll")}
          </button>
        )}
      </div>

      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {visible.map((tile) => {
          const count = facets[tile.facet] ?? 0;
          const on = active === tile.facet;
          const tone = TONE[tile.tone];
          const empty = count === 0;
          return (
            <button
              key={tile.facet}
              type="button"
              disabled={empty}
              aria-pressed={on}
              onClick={() => onChange(on ? "all" : tile.facet)}
              className={[
                "flex items-center gap-2.5 rounded-[12px] p-[10px_12px] text-start transition-all duration-base",
                on
                  ? "border bg-surface-card shadow-hover-row"
                  : "border border-transparent bg-surface-sunken",
                empty
                  ? "cursor-default opacity-50"
                  : "cursor-pointer hover:border-line hover:bg-surface-card",
                tone.fg,
              ].join(" ")}
              // Border colour follows the tone only when active; currentColor
              // keeps it in step with the icon without a second lookup table.
              style={on ? { borderColor: "currentColor" } : undefined}
            >
              <span
                aria-hidden
                className={`grid h-7 w-7 flex-none place-items-center rounded-[8px] ${tone.chip}`}
              >
                {icon(tile.facet)}
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <span
                  className={`text-[17px] font-extrabold leading-[1.15] tracking-[-0.028em] tabular-nums ${
                    empty ? "text-ink-muted" : ""
                  }`}
                >
                  {count}
                </span>
                <span
                  className={`truncate text-[12px] ${
                    on ? "font-semibold text-ink-primary" : "font-medium text-ink-secondary"
                  }`}
                >
                  {t(tile.labelKey)}
                </span>
              </span>
              {on && (
                <span
                  aria-hidden
                  className="ms-auto grid h-[19px] w-[19px] flex-none place-items-center rounded-[6px] bg-surface-sunken text-ink-secondary"
                >
                  <X size={11} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
