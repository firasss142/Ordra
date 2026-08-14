"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, Copy, MoreHorizontal, Package, Pause, Pencil, Play, PlusCircle, Truck } from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { isLowStock } from "@/lib/product-calculations";
import { formatCurrencySigned } from "@/lib/format";
import type { ProductListRow } from "@/types/product-list";

export type RowDensity = "comfortable" | "compact";

interface Props {
  row: ProductListRow;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  /** Ouvre la confirmation d'archivage. Le parent porte la modale et l'appel réseau. */
  onArchive: (id: string, name: string) => void;
  canManage: boolean;
  canToggleActive: boolean;
  /** super_admin uniquement — voir canArchiveProduct. */
  canArchive: boolean;
  locale: string;
  currency: string;
  density: RowDensity;
}

type Tone = "good" | "warn" | "bad";

/**
 * Display thresholds — NOT cost variables, so they live here rather than in the
 * settings table. They only decide which of three colours a rate is painted in.
 */
const CONFIRMATION_GOOD = 50;
const CONFIRMATION_WARN = 35;
const DELIVERY_GOOD = 40;
const DELIVERY_WARN = 25;

function tone(value: number, good: number, warn: number): Tone {
  if (value >= good) return "good";
  if (value >= warn) return "warn";
  return "bad";
}

const TONE_TEXT: Record<Tone, string> = {
  good: "text-prod-pos",
  warn: "text-status-warning",
  bad: "text-status-critical",
};
const TONE_BAR: Record<Tone, string> = {
  good: "bg-prod-pos",
  warn: "bg-status-warning",
  bad: "bg-status-critical",
};

const LABEL =
  "text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted";

/**
 * One product, one row.
 *
 * The whole row is the link to the product sheet (`role="link"` + tabIndex +
 * Enter), which is why the two controls it contains — the selection box and the
 * ⋯ menu — stop both click and keydown from reaching the container. There is no
 * drawer any more: the row navigates.
 *
 * Every figure it prints comes off `row.metrics` verbatim. Nothing financial is
 * recomputed here — in particular `delivery_rate`, which the server defines as
 * delivered / uploaded (orders still with the carrier count as not delivered).
 */
export function ProductRow({
  row,
  selected,
  onToggleSelect,
  onToggleActive,
  onAdjustStock,
  onArchive,
  canManage,
  canToggleActive,
  canArchive,
  locale,
  currency,
  density,
}: Props) {
  const t = useTranslations("products");
  const router = useRouter();

  // `market` is the MARKET CODE lib/format expects, never a currency code.
  const market = currency.toUpperCase() === "LYD" ? "LY" : "TN";
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const pct = (n: number) =>
    `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(n)} %`;

  const m = row.metrics;
  // `null` is "not permitted / not requested"; an all-zero object is "no
  // activity". They render differently on purpose.
  const hasMetrics = m !== null;
  const hasActivity = m !== null && m.total_leads > 0;

  const outOfStock = row.current_stock <= 0;
  const lowStock = !outOfStock && isLowStock(row.current_stock, row.low_stock_threshold);
  const stockTone: Tone = outOfStock ? "bad" : lowStock ? "warn" : "good";
  // Full gauge at four times the threshold; a product in stock always shows a
  // sliver so the track never reads as "zero".
  const stockPct = outOfStock
    ? 0
    : Math.max(
        4,
        Math.min(100, row.low_stock_threshold > 0 ? (row.current_stock / (row.low_stock_threshold * 4)) * 100 : 100),
      );

  /**
   * Uploaded orders still awaiting a carrier status. Derived from the period
   * counters because the list endpoint carries no current-status field yet;
   * clamped at 0 since a delivery can settle in this window against a dispatch
   * from the previous one. See notes — the exact figure needs `in_flight` off
   * `orders.status` from the server.
   */
  const inFlight = m ? Math.max(0, m.dispatched_count - m.delivered_count - m.returned_count) : 0;

  const href = `/${locale}/products/${row.id}`;
  const open = () => router.push(href);

  const menuItems: MenuItem[] = [
    {
      id: "edit",
      label: t("row.edit"),
      icon: Pencil,
      onSelect: () => router.push(`${href}/edit`),
    },
  ];
  if (canManage) {
    menuItems.push({
      id: "stock",
      label: t("row.adjustStock"),
      icon: PlusCircle,
      onSelect: () => onAdjustStock(row.id, row.name),
    });
    menuItems.push({
      id: "duplicate",
      label: t("row.duplicate"),
      icon: Copy,
      // Cloning needs a new route and a market picker; the affordance is
      // disabled rather than absent so the gap stays visible.
      disabled: true,
      onSelect: () => {},
    });
  }
  if (canToggleActive) {
    menuItems.push({
      id: "toggle",
      label: row.is_active ? t("deactivate") : t("activate"),
      icon: row.is_active ? Pause : Play,
      destructive: row.is_active,
      onSelect: () => onToggleActive(row.id),
    });
  }
  // Archiver n'apparaît QUE sur un produit déjà désactivé. Le geste est en deux
  // temps par construction — désactiver, regarder, archiver — parce qu'il retire
  // le produit de tous les sélecteurs de la console et que la liste n'offre
  // aucune annulation. La confirmation est portée par le parent, qui seul
  // connaît le nom à afficher et la route à appeler.
  if (canArchive && !row.is_active) {
    menuItems.push({
      id: "archive",
      label: t("rowList.archive"),
      icon: Archive,
      destructive: true,
      onSelect: () => onArchive(row.id, row.name),
    });
  }

  const compact = density === "compact";
  const netProfit = m?.net_profit ?? 0;
  const profitState = !m || m.revenue === 0 ? "flat" : netProfit < 0 ? "loss" : "positive";

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={t("rowList.openProduct", { name: row.name })}
      data-loss={String(hasActivity && netProfit < 0)}
      data-inactive={String(!row.is_active)}
      data-selected={String(selected)}
      data-density={density}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        open();
      }}
      className={[
        "group relative grid cursor-pointer grid-cols-3 items-center gap-4 rounded-[16px] border border-line-subtle",
        "bg-surface-card shadow-hover-row transition-[box-shadow,border-color,background-color] duration-base",
        "hover:border-line-strong hover:shadow-panel",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-prod-brand",
        // 3px critical rail on the inline-start edge, painted only on a loss.
        "before:pointer-events-none before:absolute before:inset-y-3 before:start-0 before:w-[3px]",
        "before:rounded-e-[3px] before:bg-status-critical before:opacity-0 before:content-['']",
        "data-[loss=true]:before:opacity-100",
        "data-[inactive=true]:bg-surface-sunken",
        "data-[selected=true]:border-prod-brand-soft data-[selected=true]:bg-prod-brand-tint",
        // Identity | 3 measures | profit | ⋯ — stacked below lg, where the
        // measures share one line and the menu floats to the corner.
        "lg:grid-cols-[minmax(200px,1.2fr)_repeat(3,minmax(96px,0.6fr))_200px_40px] lg:gap-3.5",
        "xl:grid-cols-[minmax(250px,1.15fr)_repeat(3,minmax(112px,0.62fr))_232px_40px] xl:gap-5",
        compact ? "min-h-[76px] p-[9px_12px]" : "min-h-[104px] p-[14px_16px]",
      ].join(" ")}
    >
      {/* ── identity ── */}
      <div className="col-span-3 flex min-w-0 items-start gap-3 lg:col-span-1">
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(row.id)}
          aria-label={t("table.selectRow", { name: row.name })}
          className="mt-[5px] h-[17px] w-[17px] flex-none cursor-pointer accent-prod-brand opacity-0 transition-opacity duration-fast checked:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
        />
        <span className="flex-none data-[inactive=true]:opacity-60" data-inactive={String(!row.is_active)}>
          <ProductAvatar imageUrl={row.image_url} productName={row.name} size={compact ? 40 : 56} />
        </span>
        <div className="min-w-0 flex-1">
          {/* dir="auto" on the NAME NODE only: the row chrome stays LTR while an
              Arabic name resolves its own direction. text-start keeps the block
              from fleeing to the far edge — direction is not alignment. */}
          <span
            dir="auto"
            className="block overflow-hidden text-start text-[14.5px] font-semibold leading-[1.34] tracking-[-0.012em] text-ink-primary [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          >
            {row.name}
          </span>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={row.is_active ? "ok" : "off"}>
              {row.is_active ? t("activeLabel") : t("inactive")}
            </Chip>
            {outOfStock && <Chip tone="bad">{t("facets.outOfStock")}</Chip>}
            {lowStock && <Chip tone="warn">{t("facets.lowStock")}</Chip>}
            {row.variant_count > 0 && (
              <Chip tone="neutral">{t("row.variants", { count: row.variant_count })}</Chip>
            )}
            {row.sku && (
              <span
                dir="auto"
                className="inline-flex h-6 items-center rounded-[8px] border border-line-subtle bg-surface-sunken px-2.5 font-mono text-[11px] font-medium text-ink-secondary"
              >
                {row.sku}
              </span>
            )}
          </div>

          {!compact && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <Package size={14} strokeWidth={2} aria-hidden className="flex-none text-ink-muted" />
                  <span className="tabular-nums">
                    {t("rowList.stockCount", { count: row.current_stock })}
                  </span>
                  <span aria-hidden className="text-ink-muted">
                    ·
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {t("rowList.stockThreshold", { count: row.low_stock_threshold })}
                  </span>
                </span>
                <span aria-hidden className="block h-3 w-px bg-line" />
                <span
                  title={t("rowList.inFlightHint")}
                  className={`inline-flex items-center gap-1.5 ${
                    inFlight > 0 ? "font-semibold text-status-action" : "font-medium text-ink-muted"
                  }`}
                >
                  <Truck size={14} strokeWidth={2} aria-hidden className="flex-none" />
                  <span className="tabular-nums">{t("rowList.inFlight", { count: inFlight })}</span>
                </span>
              </div>
              <Track value={stockPct} barClass={TONE_BAR[stockTone]} className="mt-2 max-w-[230px]" />
            </>
          )}
        </div>
      </div>

      {/* ── measures ── */}
      {hasActivity ? (
        <>
          <Measure label={t("rowList.orders")} value={num(m!.total_leads)}>
            <span className="text-[12px] font-medium text-ink-muted">{t("rowList.ordersCaption")}</span>
            <Track value={100} barClass="bg-prod-brand" className="mt-1.5" />
          </Measure>

          <Measure label={t("rowList.confirmed")} value={num(m!.confirmed_count)}>
            <Rate value={m!.confirmation_rate} good={CONFIRMATION_GOOD} warn={CONFIRMATION_WARN} format={pct} />
          </Measure>

          <Measure label={t("rowList.delivered")} value={num(m!.delivered_count)}>
            {m!.dispatched_count === 0 ? (
              <>
                <span className="text-[12px] font-medium text-ink-muted">{t("rowList.noDispatch")}</span>
                <Track value={0} barClass="bg-line" className="mt-1.5" />
              </>
            ) : (
              <Rate value={m!.delivery_rate} good={DELIVERY_GOOD} warn={DELIVERY_WARN} format={pct} />
            )}
          </Measure>

          <div
            role="group"
            aria-label={t("table.netProfit")}
            data-state={profitState}
            className="col-span-3 flex flex-col gap-0.5 rounded-[12px] border p-[11px_14px] data-[state=flat]:border-line-subtle data-[state=loss]:border-status-critical/25 data-[state=positive]:border-prod-brand-soft data-[state=flat]:bg-surface-sunken data-[state=loss]:bg-status-criticalBg data-[state=positive]:bg-prod-brand-tint lg:col-span-1"
          >
            <span className={LABEL}>{t("table.netProfit")}</span>
            <span
              dir="ltr"
              className={`whitespace-nowrap text-[19px] font-bold leading-[1.15] tracking-[-0.026em] tabular-nums ${
                netProfit < 0
                  ? "text-status-critical"
                  : netProfit > 0
                    ? "text-prod-pos"
                    : "text-ink-secondary"
              }`}
            >
              {formatCurrencySigned(netProfit, market, { fractionDigits: 0 })}
            </span>
            <span
              className={`text-[11.5px] tabular-nums ${
                m!.revenue === 0 ? "text-ink-muted" : "text-ink-secondary"
              }`}
            >
              {m!.revenue === 0
                ? t("rowList.noRevenueYet")
                : t("rowList.marginValue", { value: pct(m!.margin_pct) })}
            </span>
          </div>
        </>
      ) : (
        <div className="col-span-3 flex items-center justify-center gap-2.5 text-[13px] text-ink-muted lg:col-span-4">
          <span
            aria-hidden
            className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[10px] bg-prod-neutral-bg text-ink-secondary"
          >
            <Package size={17} strokeWidth={1.9} />
          </span>
          {hasMetrics ? t("rowList.noOrders") : t("rowList.metricsUnavailable")}
        </div>
      )}

      {/* ── row menu ── */}
      <span
        role="presentation"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="absolute end-3 top-3 lg:static lg:justify-self-end"
      >
        <Menu
          ariaLabel={t("table.actions")}
          items={menuItems}
          trigger={
            <button
              type="button"
              aria-label={t("table.actions")}
              className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-transparent text-ink-muted transition-colors duration-fast hover:border-line-subtle hover:bg-surface-sunken hover:text-ink-primary"
            >
              <MoreHorizontal size={17} strokeWidth={2} />
            </button>
          }
        />
      </span>
    </article>
  );
}

function Chip({
  tone: t,
  children,
}: {
  tone: "ok" | "off" | "warn" | "bad" | "neutral";
  children: React.ReactNode;
}) {
  const cls =
    t === "ok"
      ? "bg-prod-brand-soft text-prod-brand"
      : t === "bad"
        ? "bg-status-criticalBg text-status-critical"
        : t === "warn"
          ? "bg-status-warningBg text-status-warning"
          : "bg-prod-neutral-bg text-ink-secondary";
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-[8px] px-2.5 text-[11.5px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function Measure({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-[3px]">
      <span className={LABEL}>{label}</span>
      <span className="text-[20px] font-bold leading-[1.1] tracking-[-0.03em] tabular-nums text-ink-primary">
        {value}
      </span>
      {children}
    </div>
  );
}

function Rate({
  value,
  good,
  warn,
  format,
}: {
  value: number;
  good: number;
  warn: number;
  format: (n: number) => string;
}) {
  const t = tone(value, good, warn);
  return (
    <>
      <span dir="ltr" data-tone={t} className={`text-[12px] font-semibold tabular-nums ${TONE_TEXT[t]}`}>
        {format(value)}
      </span>
      <Track value={value} barClass={TONE_BAR[t]} className="mt-1.5" />
    </>
  );
}

/**
 * A percentage is geometry, not a colour: the width is the only inline style in
 * this file, because no utility class can express a computed percentage.
 */
function Track({
  value,
  barClass,
  className = "",
}: {
  value: number;
  barClass: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`block h-1 overflow-hidden rounded-[2px] bg-surface-sunken ${className}`.trim()}
    >
      <span
        className={`block h-full rounded-[2px] ${barClass}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}
