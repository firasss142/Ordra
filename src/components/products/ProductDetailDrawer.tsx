"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Box, DollarSign, Info, Percent, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { isLowStock } from "@/lib/product-calculations";
import { formatCurrency } from "@/lib/format";
import type { ProductListRow } from "@/types/product-list";

interface Props {
  row: ProductListRow | null;
  open: boolean;
  onClose: () => void;
  onToggleActive: (id: string) => void;
  onAdjustStock: (id: string, name: string) => void;
  canManage: boolean;
  canToggleActive: boolean;
  locale: string;
  currency: string;
  /** Window length in days. The section meta renders the compact "30j" form. */
  periodDays: number;
}

function Section({
  icon,
  title,
  meta,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-secondary">
        <span className="text-ink-muted">{icon}</span>
        {title}
        {meta && (
          <span className="ms-auto text-[12px] font-normal normal-case tracking-normal text-ink-muted">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-line-subtle bg-surface-sunken p-[13px_14px]">
      <span className="text-[11px] font-medium text-ink-secondary">{label}</span>
      <span className="text-[19px] font-bold leading-tight tracking-[-0.028em] tabular-nums">
        {value}
      </span>
      {sub && <span className="text-[11.5px] tabular-nums text-ink-secondary">{sub}</span>}
    </div>
  );
}

function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface-card p-[12px_14px]">
      <span className="text-[11px] font-medium text-ink-secondary">{k}</span>
      <span className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.016em] tabular-nums">
        {v}
      </span>
    </div>
  );
}

/**
 * Slide-over product detail. Replaces navigating away to /products/[id], so the
 * list keeps its scroll position, filters and page. Deep-linked via ?open=<id>
 * by the page client.
 *
 * Read-only in v1. Every mutation still goes through the row's ⋯ menu or the
 * full edit page, so this drawer cannot become a second, divergent write path
 * for cost fields that RLS restricts to super_admin.
 */
export function ProductDetailDrawer({
  row,
  open,
  onClose,
  onToggleActive,
  onAdjustStock,
  canManage,
  canToggleActive,
  locale,
  currency,
  periodDays,
}: Props) {
  const t = useTranslations("products");
  if (!row) return null;

  const market = currency.toUpperCase() === "LYD" ? "LY" : "TN";
  const money = (n: number) => formatCurrency(n, market);
  const pct = (n: number) =>
    `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);

  const m = row.metrics;
  const hasActivity = m !== null && m.total_leads > 0;
  const out = row.current_stock <= 0;
  const low = !out && isLowStock(row.current_stock, row.low_stock_threshold);

  /**
   * Cost composition, read straight off the wire — never recomputed here.
   *
   * An earlier version multiplied counts by unit costs client-side, which both
   * duplicated the canonical formula and could not express carrier fees at all
   * (delivery and return are summed per order at that order's own carrier's
   * rate). These six lines are guaranteed to reconcile:
   *   revenue − Σcosts === net_profit
   *
   * Zero-value lines are kept, not filtered: an absent bar reads as "this cost
   * does not apply to this product", while a zero bar says "it applies and is
   * zero". On a COD product a 0 return cost is information.
   */
  const costs = hasActivity
    ? [
        { key: "cogs", label: t("drawer.cogs"), value: m!.cogs, color: "#D72C0D" },
        { key: "delivery", label: t("drawer.delivery"), value: m!.delivery_cost, color: "#E08909" },
        { key: "returns", label: t("drawer.returns"), value: m!.return_cost, color: "#E5847E" },
        { key: "packing", label: t("drawer.packing"), value: m!.packing_cost, color: "#8C9196" },
        { key: "ads", label: t("drawer.ads"), value: m!.ad_spend, color: "#2C6ECB" },
        { key: "processing", label: t("drawer.processing"), value: m!.processing_cost, color: "#BEC3CA" },
      ]
    : [];
  const maxBar = hasActivity ? Math.max(m!.revenue, ...costs.map((c) => c.value), 1) : 1;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="end"
      width="w-full sm:w-[486px]"
      ariaLabelledBy="product-drawer-title"
    >
      <div className="flex h-full flex-col bg-surface-card">
        <div className="flex items-start gap-3.5 border-b border-line-subtle p-[20px_22px]">
          <ProductAvatar imageUrl={row.image_url} productName={row.name} size={54} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2
              id="product-drawer-title"
              dir="auto"
              className="m-0 text-[17px] font-semibold leading-snug tracking-[-0.018em] text-ink-primary"
            >
              {row.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex h-[26px] items-center rounded-[8px] px-3 text-[12.5px] font-medium ${
                  row.is_active
                    ? "bg-prod-brand-soft text-prod-brand"
                    : "bg-prod-neutral-bg text-ink-secondary"
                }`}
              >
                {row.is_active ? t("activeLabel") : t("inactive")}
              </span>
              {out && (
                <span className="inline-flex h-[26px] items-center rounded-[8px] bg-status-criticalBg px-3 text-[12px] font-semibold text-status-critical">
                  {t("facets.outOfStock")}
                </span>
              )}
              {low && (
                <span className="inline-flex h-[26px] items-center rounded-[8px] bg-status-warningBg px-3 text-[12px] font-semibold text-status-warning">
                  {t("facets.lowStock")}
                </span>
              )}
              {row.variant_count > 0 && (
                <span className="inline-flex h-[26px] items-center rounded-[8px] bg-surface-sunken px-3 text-[12px] font-medium text-ink-secondary">
                  {t("row.variants", { count: row.variant_count })}
                </span>
              )}
              {row.sku && <span className="text-[12.5px] text-ink-muted">{row.sku}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("drawer.close")}
            className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] border border-line bg-surface-card text-ink-secondary transition-colors duration-fast hover:bg-surface-sunken hover:text-ink-primary"
          >
            <X size={15} strokeWidth={2.3} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-[20px_22px_30px]">
          <Section
            icon={<DollarSign size={13} strokeWidth={2} />}
            title={t("drawer.profitability")}
            meta={t("period.compact", { count: periodDays })}
          >
            {hasActivity ? (
              <>
                <div className="flex flex-col gap-1.5 rounded-[14px] border border-prod-brand-soft bg-prod-brand-tint p-[17px_18px]">
                  <span className="text-[11px] font-medium text-ink-secondary">
                    {t("drawer.netProfit")}
                  </span>
                  <span
                    className={`text-[31px] font-bold leading-none tracking-[-0.03em] tabular-nums ${
                      m!.net_profit < 0 ? "text-status-critical" : "text-prod-pos"
                    }`}
                  >
                    {m!.net_profit > 0 ? "+" : ""}
                    {money(m!.net_profit)}
                  </span>
                  <span className="text-[11.5px] tabular-nums text-ink-secondary">
                    {t("table.margin")} {pct(m!.margin_pct)} ·{" "}
                    {t("table.costPerDelivered")} {money(m!.cost_per_delivered)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <Stat label={t("table.revenue")} value={money(m!.revenue)} />
                  <Stat
                    label={t("drawer.delivered")}
                    value={num(m!.delivered_count)}
                    sub={`${t("drawer.returned")} ${num(m!.returned_count)}`}
                  />
                  <Stat
                    label={t("drawer.perDelivered")}
                    value={
                      m!.delivered_count > 0 ? money(m!.net_profit / m!.delivered_count) : "—"
                    }
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Bar
                    label={t("table.revenue")}
                    value={m!.revenue}
                    max={maxBar}
                    color="var(--prod-pos)"
                    fmt={money}
                  />
                  {costs.map((c) => (
                    <Bar
                      key={c.key}
                      label={c.label}
                      value={c.value}
                      max={maxBar}
                      color={c.color}
                      fmt={money}
                      negative
                    />
                  ))}
                  {/* Closes the arithmetic: the bars above are only trustworthy
                      if the reader can see them land on net. */}
                  <Bar
                    label={t("drawer.net")}
                    value={m!.net_profit}
                    max={maxBar}
                    color={m!.net_profit < 0 ? "#D72C0D" : "var(--prod-pos)"}
                    fmt={money}
                    total
                    signed
                  />
                </div>

                {/* leads → confirmed → delivered */}
                <div className="flex gap-2.5">
                  <Funnel label={t("drawer.leads")} value={num(m!.total_leads)} pct="100%" width={100} />
                  <Funnel
                    label={t("drawer.confirmed")}
                    value={num(m!.confirmed_count)}
                    pct={pct(m!.confirmation_rate)}
                    width={m!.confirmation_rate}
                  />
                  <Funnel
                    label={t("drawer.delivered")}
                    value={num(m!.delivered_count)}
                    pct={pct(m!.total_leads > 0 ? (m!.delivered_count / m!.total_leads) * 100 : 0)}
                    width={m!.total_leads > 0 ? (m!.delivered_count / m!.total_leads) * 100 : 0}
                  />
                </div>
              </>
            ) : (
              <p className="m-0 rounded-[12px] border border-line-subtle bg-surface-sunken px-4 py-6 text-center text-[13px] text-ink-secondary">
                {t("metrics.noData")}
              </p>
            )}
          </Section>

          <Section icon={<Box size={13} strokeWidth={1.9} />} title={t("drawer.stock")}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line-subtle bg-line-subtle">
              <KeyValue
                k={t("table.stock")}
                v={
                  <span className={out ? "text-status-critical" : low ? "text-status-warning" : ""}>
                    {num(row.current_stock)}
                  </span>
                }
              />
              <KeyValue k={t("row.editThreshold")} v={num(row.low_stock_threshold)} />
              <KeyValue
                k={t("drawer.systemVsReal")}
                v={`${num(row.system_inventory)} / ${num(row.real_inventory)}`}
              />
              <KeyValue
                k={t("table.damaged")}
                v={
                  <span className={row.damaged_return_count > 0 ? "text-status-warning" : ""}>
                    {num(row.damaged_return_count)}
                  </span>
                }
              />
              <KeyValue k={t("table.stockValue")} v={money(row.current_stock * row.unit_cogs)} />
              <KeyValue k={t("drawer.initialStock")} v={num(row.initial_stock)} />
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => onAdjustStock(row.id, row.name)}
                className="inline-flex h-9 w-fit items-center rounded-[9px] border border-line bg-surface-card px-3.5 text-[13px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-sunken"
              >
                {t("row.adjustStock")}
              </button>
            )}
          </Section>

          <Section icon={<Percent size={13} strokeWidth={2} />} title={t("drawer.costs")}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line-subtle bg-line-subtle">
              <KeyValue k={t("table.unitCogs")} v={money(row.unit_cogs)} />
              <KeyValue k={t("table.packing")} v={money(row.packing_cost)} />
              <KeyValue
                k={t("drawer.processing")}
                v={money(row.confirmation_processing_cost)}
              />
              <KeyValue
                k={t("table.price")}
                v={row.default_price === null ? "—" : money(row.default_price)}
              />
            </div>
            <p className="m-0 flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
              <Info size={13} strokeWidth={2} aria-hidden className="mt-0.5 flex-none" />
              {t("drawer.costsReadOnly")}
            </p>
          </Section>
        </div>

        <div className="flex items-center gap-2.5 border-t border-line-subtle p-[14px_22px]">
          <Link
            href={`/${locale}/products/${row.id}`}
            className="inline-flex h-10 items-center rounded-[10px] bg-prod-brand px-4 text-[13.5px] font-semibold text-white no-underline transition-colors duration-fast hover:bg-prod-brand-hover"
          >
            {t("drawer.openFull")}
          </Link>
          {canToggleActive && (
            <button
              type="button"
              onClick={() => onToggleActive(row.id)}
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-sunken"
            >
              {row.is_active ? t("deactivate") : t("activate")}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Bar({
  label,
  value,
  max,
  color,
  fmt,
  negative,
  total,
  signed,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  fmt: (n: number) => string;
  /** Cost line — prefixed with a minus sign. */
  negative?: boolean;
  /** Summary line — rule above, heavier label. */
  total?: boolean;
  /** Show an explicit + on a positive figure (the net line). */
  signed?: boolean;
}) {
  // Math.abs so a negative net still draws a bar rather than collapsing to zero
  // width; the sign is carried by the figure and the colour.
  const width = Math.min(100, (Math.abs(value) / max) * 100);
  return (
    <div
      className={`grid grid-cols-[92px_1fr_84px] items-center gap-3 ${
        total ? "mt-0.5 border-t border-line-subtle pt-2.5" : ""
      }`}
    >
      <span
        className={
          total
            ? "text-[12.5px] font-semibold text-ink-primary"
            : "text-[12.5px] text-ink-secondary"
        }
      >
        {label}
      </span>
      <span className="block h-[7px] overflow-hidden rounded-[4px] bg-surface-sunken">
        <span
          className="block h-full rounded-[4px]"
          style={{ width: `${width.toFixed(1)}%`, background: color }}
        />
      </span>
      <span
        className={`text-end text-[12.5px] font-semibold tabular-nums ${
          total ? (value < 0 ? "text-status-critical" : "text-prod-pos") : ""
        }`}
      >
        {negative ? "−" : signed && value > 0 ? "+" : ""}
        {fmt(Math.abs(value))}
      </span>
    </div>
  );
}

function Funnel({
  label,
  value,
  pct,
  width,
}: {
  label: string;
  value: string;
  pct: string;
  width: number;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-[12px] border border-line-subtle bg-surface-sunken p-[12px_13px]">
      <span className="text-[11px] font-medium text-ink-secondary">{label}</span>
      <span className="text-[19px] font-bold leading-none tracking-[-0.026em] tabular-nums">
        {value}
      </span>
      <span className="text-[11px] tabular-nums text-ink-muted">{pct}</span>
      <span
        className="mt-1.5 block h-1 rounded-[2px] bg-prod-pos"
        style={{ width: `${Math.max(4, Math.min(100, width))}%` }}
      />
    </div>
  );
}
