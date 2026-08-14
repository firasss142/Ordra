"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Boxes,
  Lock,
  Moon,
  Clock,
  CircleAlert,
  TrendingUp,
  ShieldAlert,
  ScanLine,
  Truck,
  Rocket,
  ShoppingCart,
  PackageMinus,
  ChevronRight,
  Percent,
  Package,
  PieChart,
} from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { StockAdjustModal, type StockAdjustState } from "@/components/products/StockAdjustModal";
import { StockKpiCard, KpiChip, type KpiStat } from "@/components/stock/StockKpiCard";
import { StockProductRow, STOCK_ROW_GRID } from "@/components/stock/StockProductRow";
import { CapitalBreakdown } from "@/components/stock/CapitalBreakdown";
import { Bar, CAPITAL_COLORS, LegendDot } from "@/components/stock/StockPrimitives";
import { buildStockKey, useStockPosition } from "@/hooks/useStockPosition";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";
import {
  DEMAND_WINDOW_OPTIONS,
  DEFAULT_DEMAND_WINDOW,
  COVER_URGENT_DAYS,
  COVER_WATCH_DAYS,
  type DemandWindowDays,
  type StockAction,
  type StockProduct,
} from "@/lib/inventory/stock-position-types";

const ACTION_ICON = {
  relaunch: Rocket,
  expedite: Truck,
  liquidate: ShoppingCart,
  reduce_moq: PackageMinus,
  scan: ScanLine,
} as const;

const ACTION_TONE = {
  relaunch: "bg-brand-bg text-brand",
  expedite: "bg-oms-warn-bg text-oms-warn-ink",
  liquidate: "bg-oms-bad-bg text-oms-bad",
  reduce_moq: "bg-oms-sunken text-oms-ink-2",
  scan: "bg-oms-info-bg text-oms-info-ink",
} as const;

export function InventoryClient({ user }: { user: AuthUser }) {
  const t = useTranslations("inventory");
  const { scope, marketId: activeMarketId } = useMarketScope();
  const [windowDays, setWindowDays] = useState<DemandWindowDays>(DEFAULT_DEMAND_WINDOW);
  const [adjust, setAdjust] = useState<StockAdjustState | null>(null);

  const swrKey = useMemo(
    () => buildStockKey({ windowDays, marketId: activeMarketId }),
    [windowDays, activeMarketId],
  );
  const { position, isLoading, error, mutate } = useStockPosition(swrKey);

  const locale = user.locale === "ar" ? "ar-LY" : "fr-FR";
  const canAdjust = user.role === "super_admin";
  const showSkeleton = !position && isLoading;

  const totals = position?.totals;
  const ledger = position?.ledger;
  // Cross-market scope mixes TND and LYD. Unit counts stay valid; a single
  // currency label would not, so money is suppressed rather than mislabelled.
  const mixedCurrencies = position?.mixed_currencies ?? (user.role === "super_admin" && scope === "all");
  const currency = position?.currency ?? null;

  const nf = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale]);
  const money = (n: number) => (mixedCurrencies ? "—" : nf.format(Math.round(n)));
  const pct = (n: number) =>
    new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(n);
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  const openAdjust = (p: StockProduct) =>
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
    if (!Number.isInteger(parsed) || parsed === 0 || !adjust.note.trim()) return;
    setAdjust({ ...adjust, loading: true, error: null });
    try {
      const res = await fetch(`/api/products/${adjust.productId}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change: parsed, reason: adjust.reason, note: adjust.note.trim() }),
      });
      if (!res.ok) throw new Error("failed");
      setAdjust(null);
      void mutate();
    } catch {
      setAdjust((s) => (s ? { ...s, loading: false, error: t("adjust.errorGeneric") } : s));
    }
  };

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pt-6">
      {/* ── en-tête ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-oms-ink-1">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-[13px] text-oms-ink-2">{t("subtitle")}</p>
        </div>
        <div className="ms-auto flex gap-0.5 rounded-lg border border-oms-border bg-oms-sunken p-0.5">
          {DEMAND_WINDOW_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              role="tab"
              aria-selected={w === windowDays}
              onClick={() => setWindowDays(w)}
              className={`rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-fast ${
                w === windowDays
                  ? "bg-oms-surface font-semibold text-oms-ink-1 shadow-[inset_0_0_0_1px_var(--brand)]"
                  : "text-oms-ink-2 hover:text-oms-ink-1"
              }`}
            >
              {t(`window.${w}`)}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-card border border-oms-bad bg-oms-bad-bg px-4 py-3 text-[12.5px] text-oms-bad"
        >
          {t("loadError")}
        </div>
      ) : null}

      {mixedCurrencies ? (
        <div className="rounded-card border border-oms-border bg-oms-surface px-4 py-2.5 text-[12.5px] text-oms-ink-2">
          {t("scopeAllCurrencyNote")}
        </div>
      ) : null}

      {/*
        The carrier-held and unscanned-stock warnings used to sit here as two
        bands. They are conditions wanting action, not context for reading the
        table, so they now emit as `stock_unreconciled` alerts — one row per
        product, on the alerts page with everything else that needs doing. The
        per-row source chip below still says which register is authoritative.
      */}
      {/* ── tuiles ── */}
      {showSkeleton ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[196px] rounded-card" />
          ))}
        </div>
      ) : totals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StockKpiCard
            label={t("kpi.stockValue")}
            value={money(totals.stock_value)}
            unit={mixedCurrencies ? null : currency}
            visual={
              <Bar
                className="mt-3"
                segments={[
                  {
                    key: "a",
                    width: share(totals.active_value, totals.stock_value),
                    color: CAPITAL_COLORS.active,
                  },
                  {
                    key: "e",
                    width: share(totals.engaged_value, totals.stock_value),
                    color: CAPITAL_COLORS.engaged,
                  },
                  {
                    key: "d",
                    width: share(totals.dormant_value, totals.stock_value),
                    color: CAPITAL_COLORS.dormant,
                  },
                ]}
              />
            }
            stats={[
              { icon: Boxes, tone: "ok", value: money(totals.active_value), label: t("kpi.free") },
              { icon: Lock, tone: "warn", value: money(totals.engaged_value), label: t("kpi.engaged") },
              { icon: Moon, tone: "muted", value: money(totals.dormant_value), label: t("kpi.dormant") },
            ]}
          />

          <StockKpiCard
            label={t("kpi.daysToStockout")}
            value={totals.min_days_of_cover === null ? "—" : nf.format(totals.min_days_of_cover)}
            unit={totals.min_days_of_cover === null ? null : t("kpi.daysUnit")}
            negative={totals.min_days_of_cover !== null && totals.min_days_of_cover <= COVER_URGENT_DAYS}
            chips={
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {totals.min_cover_stock_out_date ? (
                  <KpiChip tone="ok" icon={Clock}>
                    {day(totals.min_cover_stock_out_date)}
                  </KpiChip>
                ) : (
                  <KpiChip tone="muted">{t("kpi.noStockout")}</KpiChip>
                )}
              </div>
            }
            stats={[
              { icon: TrendingUp, tone: "ok", value: nf.format(totals.cover_ok_count), label: t("kpi.productsOk") },
              {
                icon: Clock,
                tone: "warn",
                value: nf.format(totals.cover_watch_count),
                label: t("kpi.coverWatch", { days: COVER_WATCH_DAYS }),
              },
              {
                icon: CircleAlert,
                tone: "bad",
                value: nf.format(totals.cover_urgent_count),
                label: t("kpi.coverUrgent", { days: COVER_URGENT_DAYS }),
              },
            ]}
          />

          <StockKpiCard
            label={t("kpi.dormantCapital")}
            value={money(totals.dormant_value)}
            unit={mixedCurrencies ? null : currency}
            chips={
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <KpiChip tone={totals.dormant_share > 0.5 ? "bad" : "ok"}>
                  {pct(totals.dormant_share)}
                </KpiChip>
                <span className="text-[12.5px] text-oms-ink-2">{t("kpi.ofStock")}</span>
              </div>
            }
            stats={[
              { icon: Package, tone: "muted", value: nf.format(totals.dormant_products), label: t("kpi.products") },
              {
                icon: PieChart,
                tone: "muted",
                value:
                  totals.dormant_avg_age_days === null
                    ? "—"
                    : `${nf.format(totals.dormant_avg_age_days)} ${t("kpi.daysUnit")}`,
                label: t("kpi.avgAge"),
              },
              { icon: Moon, tone: "muted", value: nf.format(totals.dormant_units), label: t("kpi.units") },
            ]}
          />

          <StockKpiCard
            label={t("kpi.reliability")}
            value={`${totals.drift_units > 0 ? "−" : ""}${nf.format(Math.abs(totals.drift_units))}`}
            unit="u"
            negative={totals.drift_units !== 0}
            chips={
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <KpiChip tone="bad" icon={ShieldAlert}>
                  {t("kpi.unverified")}
                </KpiChip>
                <KpiChip tone="muted" icon={Clock}>
                  {ledger?.last_movement_at
                    ? t("kpi.lastMovement", {
                        days: daysSince(ledger.last_movement_at, position?.generated_at),
                      })
                    : t("kpi.neverCounted")}
                </KpiChip>
              </div>
            }
            stats={[
              { icon: Package, tone: "bad", value: nf.format(totals.drift_products), label: t("kpi.products") },
              { icon: Percent, tone: "bad", value: pct(totals.drift_share), label: t("kpi.impactedRate") },
              {
                icon: TrendingUp,
                tone: "muted",
                value: money(totals.drift_daily_impact),
                label: t("kpi.dailyImpact"),
              },
            ]}
          />
        </div>
      ) : null}

      {/* ── tableau ── */}
      <section className="mt-1">
        <div className="mb-2.5 flex items-center gap-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
            {t("table.title")}
          </span>
          <span className="text-[11px] text-oms-ink-3">{t("table.scope", { days: windowDays })}</span>
        </div>

        <div className="rounded-card border border-oms-border bg-oms-surface">
          <div className={`${STOCK_ROW_GRID} border-b border-oms-border px-4 pb-2.5 pt-3.5`}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.product")}
              <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-oms-ink-3">
                {t("table.cols.unitCost")}
              </span>
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.position")}
              <span className="mt-1 flex gap-3 normal-case tracking-normal">
                <LegendDot color={CAPITAL_COLORS.dormant}>{t("table.legend.register")}</LegendDot>
                <LegendDot color={CAPITAL_COLORS.engaged}>{t("table.legend.engaged")}</LegendDot>
                <LegendDot color={CAPITAL_COLORS.active}>{t("table.legend.free")}</LegendDot>
              </span>
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.cover")}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.demand")}
            </span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.returns")}
            </span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.value")}
            </span>
            <span className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-oms-ink-3">
              {t("table.cols.verdict")}
            </span>
          </div>

          {showSkeleton ? (
            <div className="space-y-2 p-4" role="status">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </div>
          ) : position && position.products.length > 0 ? (
            <ul>
              {position.products.map((p) => (
                <StockProductRow
                  key={p.id}
                  p={p}
                  locale={locale}
                  formatMoney={money}
                  onAdjust={canAdjust ? () => openAdjust(p) : undefined}
                  labels={{
                    verdict: t(`verdict.${p.state}`),
                    stockOutOn: p.stock_out_date ? t("table.stockOutOn", { date: day(p.stock_out_date) }) : null,
                    reorderBy: p.reorder_by_date
                      ? isPast(p.reorder_by_date, position.generated_at)
                        ? t("table.reorderLate")
                        : t("table.reorderBy", { date: day(p.reorder_by_date) })
                      : null,
                    dormantFor:
                      p.days_since_last_sale === null
                        ? t("table.neverSold")
                        : t("table.dormantFor", { days: p.days_since_last_sale }),
                    perDay: t("table.perDay", {
                      rate: p.demand_rate_per_day.toLocaleString(locale, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }),
                    }),
                    demandTotal: t("table.demandTotal", { units: nf.format(p.demand_units) }),
                    register: t("table.ownWarehouse"),
                    engaged: t("table.legend.engaged"),
                    free: t("table.legend.free"),
                    adjust: t("table.adjust", { name: p.name }),
                    sparkAria: t("table.sparkAria", { days: windowDays }),
                    unverified: p.drift_units !== 0 ? t("table.unverifiedValue") : null,
                  }}
                />
              ))}
            </ul>
          ) : (
            <div className="grid min-h-[120px] place-items-center text-[13px] text-oms-ink-3">
              {t("table.empty")}
            </div>
          )}
        </div>
      </section>

      {/* ── bas de page ── */}
      <div className="mt-1 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
        <section>
          <div className="mb-2.5 flex items-baseline gap-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
              {t("capital.title")}
            </span>
            <span className="text-[11px] text-oms-ink-3">{t("capital.scope")}</span>
          </div>
          <div className="rounded-card border border-oms-border bg-oms-surface p-4">
            {showSkeleton || !totals || !position ? (
              <Skeleton className="h-[212px] rounded-lg" />
            ) : (
              <CapitalBreakdown
                totals={totals}
                products={position.products}
                formatMoney={money}
                formatPct={pct}
                labels={{
                  active: t("capital.active"),
                  engaged: t("capital.engaged"),
                  dormant: t("capital.dormant"),
                  others: t("capital.others"),
                }}
              />
            )}
          </div>
        </section>

        <section>
          <div className="mb-2.5 flex items-baseline gap-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
              {t("actions.title")}
            </span>
            {position && position.actions.length > 0 ? (
              <span className="ms-auto text-[11px] font-semibold uppercase tracking-[0.05em] text-oms-ink-2">
                {t("actions.total")}
                <b className="ms-1.5 text-[14px] font-bold tabular-nums tracking-normal text-brand-hover">
                  {money(position.actions.reduce((s, a) => s + a.amount, 0))}
                </b>
              </span>
            ) : null}
          </div>
          <div className="rounded-card border border-oms-border bg-oms-surface px-2 py-1.5">
            {showSkeleton ? (
              <div className="space-y-2 p-2" role="status">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            ) : position && position.actions.length > 0 ? (
              <ul>
                {position.actions.slice(0, 5).map((a, i) => (
                  <ActionRow
                    key={`${a.kind}-${a.product_id ?? i}`}
                    action={a}
                    first={i === 0}
                    locale={user.locale}
                    title={actionTitle(t, a)}
                    why={actionWhy(t, a, day)}
                    amount={money(a.amount)}
                    currency={mixedCurrencies ? null : currency}
                  />
                ))}
              </ul>
            ) : (
              <div className="grid min-h-[120px] place-items-center text-[13px] text-oms-ink-3">
                {t("actions.empty")}
              </div>
            )}
          </div>
        </section>
      </div>

      {adjust ? (
        <StockAdjustModal
          state={adjust}
          onChange={(patch) => setAdjust((s) => (s ? { ...s, ...patch } : s))}
          onClose={() => setAdjust(null)}
          onSubmit={submitAdjust}
        />
      ) : null}
    </div>
  );
}

/* ────────────────────────── helpers ────────────────────────── */

function share(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function daysSince(iso: string, nowIso?: string): number {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  return Math.max(0, Math.round((now - Date.parse(iso)) / 86_400_000));
}

function isPast(iso: string, nowIso?: string): boolean {
  const now = nowIso ? Date.parse(nowIso.slice(0, 10)) : Date.now();
  return Date.parse(`${iso}T00:00:00Z`) <= now;
}

type T = ReturnType<typeof useTranslations<"inventory">>;

function actionTitle(t: T, a: StockAction): string {
  return t(`actions.${a.kind}`, { name: a.product_name ?? "" });
}

function actionWhy(t: T, a: StockAction, day: (iso: string) => string): string {
  const d = a.detail;
  switch (a.kind) {
    case "relaunch":
      return t("actions.relaunchWhy", {
        units: Number(d.units ?? 0),
        days: Number(d.days_since_last_sale ?? 0),
      });
    case "expedite":
      return t("actions.expediteWhy", {
        date: d.stock_out_date ? day(String(d.stock_out_date)) : "—",
      });
    case "liquidate":
      return t("actions.liquidateWhy", { units: Math.abs(Number(d.deficit ?? 0)) });
    case "reduce_moq":
      return t("actions.reduce_moqWhy", {
        units: Number(d.free_units ?? 0),
        days: Number(d.days_of_cover ?? 0),
      });
    default:
      return "";
  }
}

function ActionRow({
  action,
  first,
  title,
  why,
  amount,
  currency,
}: {
  action: StockAction;
  first: boolean;
  locale: string;
  title: string;
  why: string;
  amount: string;
  currency: string | null;
}) {
  const Icon = ACTION_ICON[action.kind];
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border-b border-oms-border px-3 py-3 last:border-b-0 hover:bg-oms-sunken ${
        first ? "border-b-transparent bg-brand-tint shadow-[inset_3px_0_0_var(--brand)]" : ""
      }`}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ACTION_TONE[action.kind]}`}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold leading-snug text-oms-ink-1" dir="auto">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] text-oms-ink-2" dir="auto">
          {why}
        </div>
      </div>
      <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-oms-ink-1">
        {amount}
        {currency ? (
          <em className="ms-1 text-[0.72em] font-semibold not-italic text-oms-ink-3">{currency}</em>
        ) : null}
      </span>
      <ChevronRight size={16} className="shrink-0 text-oms-ink-3" aria-hidden />
    </li>
  );
}
