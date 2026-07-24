"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  PackageX,
  Archive,
  Flame,
  ShieldAlert,
  ArrowRight,
  Pencil,
} from "lucide-react";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { StockAdjustModal, type StockAdjustState } from "@/components/products/StockAdjustModal";
import { useInventorySummary } from "@/hooks/useInventorySummary";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";
import type { InventorySummary } from "@/app/api/inventory/summary/route";
import { LOW_DAYS_OF_SUPPLY, type HealthClass } from "@/lib/calculations/inventory-intelligence";

type Product = InventorySummary["products"][number];
type Movement = InventorySummary["recent_movements"][number];
type Reorder = InventorySummary["reorder_suggestions"][number];
type DayBucket = InventorySummary["movements_by_day"][number];
type I18n = ReturnType<typeof useTranslations<"inventory">>;

export function InventoryClient({ user }: { user: AuthUser }) {
  const t = useTranslations("inventory");
  const { scope, marketId: activeMarketId, marketCode } = useMarketScope();
  const { inventory, isLoading, error, mutate } = useInventorySummary({
    marketId: activeMarketId ?? undefined,
  });

  const [adjust, setAdjust] = useState<StockAdjustState | null>(null);
  const totals = inventory?.totals;
  const canAdjust = user.role === "super_admin";
  // Cross-market scope sums TND and LYD units — unit counts stay valid but a
  // single currency label would be wrong, so currency values are suppressed.
  const mixedCurrencies = user.role === "super_admin" && scope === "all";
  const market = marketCode ? marketCode.toUpperCase() : user.locale === "ar" ? "LY" : "TN";
  const showSkeleton = !inventory && isLoading;

  const openAdjust = (p: Product) =>
    setAdjust({
      productId: p.id,
      productName: p.name,
      change: "",
      reason: "manual_adjustment",
      note: "",
      loading: false,
      error: null,
    });

  const submitAdjust = async () => {
    if (!adjust) return;
    const parsed = Number(adjust.change);
    if (!Number.isInteger(parsed) || parsed === 0 || !adjust.note.trim()) {
      setAdjust({ ...adjust, error: t("adjust.errorGeneric") });
      return;
    }
    setAdjust({ ...adjust, loading: true, error: null });
    try {
      const res = await fetch(`/api/products/${adjust.productId}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: parsed, reason: adjust.reason, note: adjust.note.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "" }));
        setAdjust({ ...adjust, loading: false, error: body.error || t("adjust.errorGeneric") });
        return;
      }
      setAdjust(null);
      void mutate();
    } catch {
      setAdjust({ ...adjust, loading: false, error: t("adjust.errorGeneric") });
    }
  };

  return (
    <div className="bg-surface-page min-h-screen px-4 py-6 pb-16 sm:px-6 md:px-8">
      <header className="mb-5">
        <h1 className="text-[20px] font-semibold text-ink-primary m-0">{t("title")}</h1>
        <p className="text-[13px] text-ink-secondary mt-1 mb-0">{t("subtitle")}</p>
      </header>

      {error && (
        <div
          role="alert"
          className="px-3.5 py-3 rounded-[6px] text-[13px] mb-4"
          style={{ backgroundColor: "#FFF4F4", color: "#D72C0D" }}
        >
          {t("loadError")}
        </div>
      )}

      {mixedCurrencies && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[8px] bg-surface-card border border-line-subtle text-[12px] text-ink-secondary">
          {t("scopeAllCurrencyNote")}
        </div>
      )}

      {showSkeleton ? (
        <div role="status" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
      ) : (
        <HeroStrip totals={totals} market={market} mixedCurrencies={mixedCurrencies} t={t} />
      )}

      <div className="grid grid-cols-1 gap-4 mt-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t("reorder.title")} minHeight={240}>
          {showSkeleton ? (
            <SkeletonRows count={4} />
          ) : !inventory?.reorder_suggestions.length ? (
            <EmptyState label={t("reorder.empty")} />
          ) : (
            <ReorderList rows={inventory.reorder_suggestions} locale={user.locale} t={t} />
          )}
        </Panel>

        <Panel title={t("movementsTimeline.title")} minHeight={240}>
          {showSkeleton ? (
            <SkeletonRows count={6} />
          ) : !inventory?.movements_by_day.length ? (
            <EmptyState label={t("movementsTimeline.empty")} />
          ) : (
            <MovementsDailyList rows={inventory.movements_by_day} locale={user.locale} t={t} />
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("products.title")} minHeight={320}>
          {showSkeleton ? (
            <SkeletonRows count={8} />
          ) : !inventory || inventory.products.length === 0 ? (
            <EmptyState label={t("products.empty")} />
          ) : (
            <ProductsTable
              rows={inventory.products}
              locale={user.locale}
              market={market}
              mixedCurrencies={mixedCurrencies}
              canAdjust={canAdjust}
              onAdjust={openAdjust}
              t={t}
            />
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("movements.title")} minHeight={280}>
          {showSkeleton ? (
            <SkeletonRows count={6} />
          ) : !inventory || inventory.recent_movements.length === 0 ? (
            <EmptyState label={t("movements.empty")} />
          ) : (
            <MovementsList rows={inventory.recent_movements} locale={user.locale} t={t} />
          )}
        </Panel>
      </div>

      {adjust && (
        <StockAdjustModal
          state={adjust}
          onChange={(patch) => setAdjust((prev) => (prev ? { ...prev, ...patch } : prev))}
          onSubmit={submitAdjust}
          onClose={() => setAdjust(null)}
        />
      )}
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div role="status" className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

function HeroStrip({
  totals,
  market,
  mixedCurrencies,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  market: string;
  mixedCurrencies: boolean;
  t: I18n;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2.6fr)]">
      <StockValueCard totals={totals} market={market} mixedCurrencies={mixedCurrencies} t={t} />
      <HealthBreakdown totals={totals} t={t} />
    </div>
  );
}

function StockValueCard({
  totals,
  market,
  mixedCurrencies,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  market: string;
  mixedCurrencies: boolean;
  t: I18n;
}) {
  return (
    <div className="bg-surface-card border border-line-subtle rounded-[8px] px-[22px] py-5 flex flex-col gap-2 min-h-[132px] transition-shadow duration-fast hover:shadow-hover-row">
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
        {t("totals.stockValue")}
      </div>
      <div className="text-[32px] font-bold tabular-nums leading-[1.1] text-ink-primary">
        {mixedCurrencies || !totals ? "—" : formatCurrency(totals.stock_value, market)}
      </div>
      <div className="text-[13px] text-ink-secondary">
        {totals ? t("totals.productsTracked", { count: totals.products_tracked }) : ""}
      </div>
      {totals && totals.scan_out_qty_30d > 0 && (
        <div className="text-[12px] text-ink-muted mt-auto">
          {t("totals.scannedOut30d", { count: totals.scan_out_qty_30d })}
        </div>
      )}
    </div>
  );
}

function HealthBreakdown({
  totals,
  t,
}: {
  totals: InventorySummary["totals"] | undefined;
  t: I18n;
}) {
  const items: Array<{ icon: typeof CheckCircle2; key: string; value: number; tone: HealthClass | "reorder" }> = [
    { icon: CheckCircle2, key: "healthy", value: totals?.healthy_count ?? 0, tone: "healthy" },
    { icon: Flame, key: "reorder", value: totals?.reorder_count ?? 0, tone: "reorder" },
    { icon: AlertTriangle, key: "low", value: totals?.low_stock_count ?? 0, tone: "low" },
    { icon: PackageX, key: "out", value: totals?.out_of_stock_count ?? 0, tone: "out" },
    { icon: Archive, key: "overstocked", value: totals?.overstocked_count ?? 0, tone: "overstocked" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map(({ icon: Icon, key, value, tone }) => {
        const palette = HEALTH_PALETTE[tone];
        return (
          <div
            key={key}
            className="bg-surface-card border border-line-subtle rounded-[8px] px-4 py-3.5 flex flex-col gap-2 min-h-[132px] transition-shadow duration-fast hover:shadow-hover-row"
          >
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
              <Icon size={14} strokeWidth={2} color={palette.fg} aria-hidden="true" />
              {t(`healthBreakdown.${key}`)}
            </div>
            <div className="text-[26px] font-bold text-ink-primary tabular-nums leading-[1.1]">
              {value}
            </div>
            <div className="text-[12px] text-ink-secondary mt-auto">
              {t(`healthBreakdown.${key}_hint`)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReorderList({
  rows,
  locale,
  t,
}: {
  rows: Reorder[];
  locale: string;
  t: I18n;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {rows.map((r) => {
        const urgency = r.days_of_supply <= 3 ? "critical" : r.days_of_supply <= 7 ? "warning" : "neutral";
        const fg =
          urgency === "critical" ? "#D72C0D" : urgency === "warning" ? "#B98900" : "#1A1A1A";
        return (
          <li key={r.id}>
            <Link
              href={`/${locale}/products/${r.id}`}
              className="flex items-center gap-2.5 px-3 py-2.5 bg-surface-card border border-line-subtle rounded-[6px] no-underline text-ink-primary transition-shadow duration-fast hover:shadow-hover-row"
            >
              <AlertOctagon size={16} strokeWidth={2} color={fg} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                  {r.name}
                </div>
                <div className="text-[12px] text-ink-secondary">
                  {t("reorder.stockOut", {
                    days: r.days_of_supply,
                    rate: formatRate(r.avg_daily_sales),
                  })}
                </div>
              </div>
              <div className="text-[13px] font-semibold tabular-nums" style={{ color: fg }}>
                {t("reorder.daysShort", { days: r.days_of_supply })}
              </div>
              <ArrowRight size={14} strokeWidth={2} color="#6D7175" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MovementsDailyList({ rows, locale, t }: { rows: DayBucket[]; locale: string; t: I18n }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net_change)));
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1">
      {rows.map((r) => {
        const widthPct = Math.max(4, Math.round((Math.abs(r.net_change) / max) * 100));
        const positive = r.net_change >= 0;
        const barColor = positive ? "#008060" : "#D72C0D";
        return (
          <li
            key={r.day}
            className="grid items-center gap-2 px-1 py-1.5 text-[13px]"
            style={{ gridTemplateColumns: "minmax(64px,90px) 1fr minmax(40px,56px) minmax(32px,48px)" }}
          >
            <div className="text-ink-secondary tabular-nums">{formatDate(r.day, locale)}</div>
            <div className="h-2 bg-surface-selected rounded-[4px] relative overflow-hidden">
              <div
                className="h-full rounded-[4px]"
                style={{ width: `${widthPct}%`, background: barColor }}
              />
            </div>
            <div className="font-semibold tabular-nums text-end" style={{ color: barColor }}>
              {positive ? "+" : ""}
              {r.net_change}
            </div>
            <div className="text-ink-secondary text-[12px] text-end">
              {t("movementsTimeline.countShort", { count: r.movement_count })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProductsTable({
  rows,
  locale,
  market,
  mixedCurrencies,
  canAdjust,
  onAdjust,
  t,
}: {
  rows: Product[];
  locale: string;
  market: string;
  mixedCurrencies: boolean;
  canAdjust: boolean;
  onAdjust: (p: Product) => void;
  t: I18n;
}) {
  const thClass =
    "px-3 py-2.5 text-[11px] font-medium text-ink-secondary uppercase tracking-[0.05em] text-start whitespace-nowrap";
  const tdClass = "px-3 py-2.5 text-[13px] text-ink-primary";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={thClass}>{t("products.cols.name")}</th>
            <th className={thClass}>{t("products.cols.health")}</th>
            <th className={`${thClass} text-end`}>{t("products.cols.stock")}</th>
            <th className={`${thClass} text-end`}>{t("products.cols.daysOfSupply")}</th>
            <th className={`${thClass} text-end`}>{t("products.cols.turnover")}</th>
            <th className={`${thClass} text-end`}>{t("products.cols.value")}</th>
            <th className={`${thClass} text-end`}>{t("products.cols.damaged")}</th>
            {canAdjust && <th className={thClass} aria-label="actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-line-subtle">
              <td className={tdClass}>
                <Link
                  href={`/${locale}/products/${p.id}`}
                  className="text-ink-primary no-underline font-medium"
                >
                  {p.name}
                </Link>
              </td>
              <td className={tdClass}>
                <HealthPill health={p.health} t={t} />
              </td>
              <td className={`${tdClass} text-end tabular-nums`}>
                {p.current_stock}
                <span className="text-ink-secondary ms-1">
                  {t("products.thresholdShort", { threshold: p.low_stock_threshold })}
                </span>
              </td>
              <td className={`${tdClass} text-end tabular-nums`}>
                {p.days_of_supply === null ? (
                  <span className="text-ink-secondary">—</span>
                ) : (
                  <span
                    className="font-medium"
                    style={{ color: p.days_of_supply < LOW_DAYS_OF_SUPPLY ? "#D72C0D" : "#1A1A1A" }}
                  >
                    {t("products.daysShort", { days: p.days_of_supply })}
                  </span>
                )}
              </td>
              <td className={`${tdClass} text-end tabular-nums`}>
                {p.turnover_30d > 0 ? (
                  <span>{p.turnover_30d.toFixed(1)}×</span>
                ) : (
                  <span className="text-ink-secondary">—</span>
                )}
              </td>
              <td className={`${tdClass} text-end tabular-nums`}>
                {mixedCurrencies ? p.stock_value.toLocaleString() : formatCurrency(p.stock_value, market)}
              </td>
              <td className={`${tdClass} text-end tabular-nums`}>
                <span
                  className="inline-flex items-center gap-1"
                  style={{
                    color: p.is_damaged_outlier ? "#D72C0D" : "#1A1A1A",
                    fontWeight: p.is_damaged_outlier ? 600 : 400,
                  }}
                >
                  {p.is_damaged_outlier && <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />}
                  {p.damaged_return_count}
                  {p.damaged_rate > 0 && (
                    <span className="text-ink-secondary font-normal">
                      ({Math.round(p.damaged_rate * 100)}%)
                    </span>
                  )}
                </span>
              </td>
              {canAdjust && (
                <td className={`${tdClass} text-end`}>
                  <button
                    type="button"
                    onClick={() => onAdjust(p)}
                    aria-label={t("adjust.openLabel", { name: p.name })}
                    className="inline-flex items-center gap-1 bg-surface-card border border-line rounded-[4px] px-2.5 py-1 text-[12px] text-ink-primary cursor-pointer hover:bg-surface-hover transition-colors duration-fast"
                  >
                    <Pencil size={12} strokeWidth={2} aria-hidden="true" />
                    {t("adjust.button")}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementsList({
  rows,
  locale,
  t,
}: {
  rows: Movement[];
  locale: string;
  t: I18n;
}) {
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
      {rows.map((m) => {
        const sign = m.change > 0 ? "+" : "";
        const color = m.change > 0 ? "#008060" : m.change < 0 ? "#D72C0D" : "#6D7175";
        const href = m.order_id
          ? `/${locale}/orders/${m.order_id}`
          : `/${locale}/products/${m.product_id}`;
        return (
          <li key={m.id}>
            <Link
              href={href}
              className="grid items-center gap-2.5 px-2.5 py-2 border border-line-subtle rounded-[6px] no-underline text-ink-primary transition-shadow duration-fast hover:shadow-hover-row"
              style={{ gridTemplateColumns: "1fr auto auto" }}
            >
              <span className="min-w-0 overflow-hidden">
                <div className="text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                  {m.product_name}
                </div>
                <div className="text-[12px] text-ink-secondary">
                  {reasonLabel(m.reason, t)} · {formatDateTime(m.created_at, locale)}
                  {m.order_id ? ` · ${t("movements.hasOrder")}` : ""}
                </div>
              </span>
              <span className="text-[13px] font-semibold tabular-nums whitespace-nowrap" style={{ color }}>
                {sign}
                {m.change}
              </span>
              <span className="text-[12px] text-ink-secondary tabular-nums">
                {t("movements.balanceShort", { balance: m.balance_after })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function HealthPill({ health, t }: { health: HealthClass; t: I18n }) {
  const palette = HEALTH_PALETTE[health];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[12px] font-medium"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {t(`healthPill.${health}`)}
    </span>
  );
}

const HEALTH_PALETTE: Record<
  HealthClass | "reorder",
  { bg: string; fg: string }
> = {
  healthy: { bg: "#F1F8F5", fg: "#008060" },
  low: { bg: "#FFF8E6", fg: "#B98900" },
  out: { bg: "#FFF4F4", fg: "#D72C0D" },
  overstocked: { bg: "#F6F6F7", fg: "#6D7175" },
  reorder: { bg: "#FFF4F4", fg: "#D72C0D" },
};

// 'scanned' is the current warehouse scan-out reason; 'deposit' and
// 'damaged_return' remain only for pre-migration rows (log is append-only).
const KNOWN_REASONS = new Set([
  "scanned",
  "deposit",
  "returned",
  "damaged_return",
  "manual_adjustment",
  "damaged_writeoff",
  "initial_stock",
]);

type KnownReason = typeof KNOWN_REASONS extends Set<infer T> ? T : never;

function reasonLabel(reason: string, t: I18n): string {
  if (KNOWN_REASONS.has(reason as KnownReason)) {
    return t(`movements.reasons.${reason as KnownReason}`);
  }
  return reason;
}

function formatRate(value: number): string {
  if (value === 0) return "0";
  if (value < 1) return value.toFixed(1);
  return Math.round(value).toString();
}
