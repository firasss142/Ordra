"use client";

import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { ProductEconomics, EconomicsMeta } from "@/hooks/useAdSpendEconomics";

/**
 * The three views that replaced the old rollup tiles.
 *
 * The page used to lead with four totals — this week, this month, YTD, cost per
 * confirmation — which say how much was spent but never whether spending it was
 * a good idea. These three answer that instead: the chain shows what the money
 * turned into, the bars show whether each product can afford its own leads, and
 * the stack shows where a delivered order's revenue actually goes.
 */

/* Cost-stack palette. Validated against #FFFFFF: every step inside the
   lightness band, chroma above the grey floor, worst adjacent CVD ΔE 15.2 and
   normal-vision ΔE 22.6. The one sub-3:1 step is relieved by the legend and the
   figures beside it, which is the documented mitigation. */
const COST_COLORS = {
  pub: "#ea6a1f",
  cogs: "#2563eb",
  delivery: "#0d9488",
  returns: "#6d5ce0",
  packing: "#e87ba4",
  profit: "#15803d",
} as const;

function fmt(n: number, d = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function signed(n: number, d = 2): string {
  return `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), d)}`;
}
function pct(n: number, d = 1): string {
  return `${fmt(n * 100, d)} %`;
}

/* ═══════════ 1. The chain ═══════════ */

export function AdSpendChain({
  meta,
  currency,
}: {
  meta: EconomicsMeta;
  currency: string;
}) {
  const t = useTranslations("adSpend.economics");

  const steps = [
    { head: t("spent"), value: fmt(meta.total_spend), unit: currency, sub: t("spentSub") },
    { head: t("leadsReceived"), value: fmt(meta.total_leads), unit: "", sub: t("leadsSub") },
    { head: t("confirmedOrders"), value: fmt(meta.total_confirmed), unit: "", sub: t("confirmedSub") },
    { head: t("deliveredPaid"), value: fmt(meta.total_delivered), unit: "", sub: t("deliveredSub") },
    { head: t("collected"), value: fmt(meta.total_revenue), unit: currency, sub: t("collectedSub") },
    { head: t("netProfit"), value: fmt(meta.total_profit), unit: currency, sub: t("netProfitSub"), good: true },
  ];

  const links = [
    { b: meta.total_leads > 0 ? fmt(meta.total_spend / meta.total_leads, 2) : "—", s: `${currency} / lead` },
    { b: meta.total_leads > 0 ? pct(meta.total_confirmed / meta.total_leads) : "—", s: t("confirmRate") },
    { b: meta.total_confirmed > 0 ? pct(meta.total_delivered / meta.total_confirmed) : "—", s: t("arriveRate") },
    { b: meta.total_delivered > 0 ? fmt(meta.total_revenue / meta.total_delivered, 2) : "—", s: `${currency} / ${t("perDelivery")}` },
    { b: `− ${fmt(meta.total_costs)} ${currency}`, s: t("ofWhichAds", { amount: fmt(meta.total_spend) }), cost: true },
  ];

  return (
    <div className="bg-surface-card border border-line-subtle rounded-card px-5 py-4 flex flex-wrap items-start gap-y-4">
      {steps.map((s, i) => (
        <div key={s.head} className="flex items-start">
          <div className="flex flex-col min-w-[112px]">
            <span className="text-[12.5px] font-semibold text-ink-primary whitespace-nowrap">{s.head}</span>
            <span
              className={`text-[27px] font-bold tracking-[-0.022em] leading-[1.15] mt-[7px] ${
                s.good ? "text-brand-hover" : "text-ink-primary"
              }`}
            >
              {s.value}
              {s.unit && <span className="text-[0.46em] font-semibold text-ink-secondary ms-1">{s.unit}</span>}
            </span>
            <span className="text-[11.5px] text-ink-secondary mt-[3px] whitespace-nowrap">{s.sub}</span>
          </div>
          {links[i] && (
            <div className="hidden xl:flex flex-col items-center justify-center px-3 mt-5 min-w-[92px]">
              <span
                className={`rounded-[8px] px-2.5 py-1 text-center border ${
                  links[i].cost
                    ? "bg-critical-bg border-critical/25 text-critical"
                    : "bg-surface-card border-line text-ink-primary"
                }`}
              >
                <span className="block text-[13.5px] font-bold tabular-nums leading-tight">{links[i].b}</span>
                <span className="block text-[10.5px] mt-[1px] whitespace-nowrap opacity-80">{links[i].s}</span>
              </span>
              <ArrowRight className="w-[26px] h-[9px] text-ink-tertiary mt-1.5" strokeWidth={1.5} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════ 2. CPL vs the product's own floor ═══════════ */

export function AdSpendCplBars({
  products,
  currency,
}: {
  products: ProductEconomics[];
  currency: string;
}) {
  const t = useTranslations("adSpend.economics");

  const scaleMax = Math.max(
    10,
    ...products.map((p) => Math.max(p.cpl, p.break_even_cpl) * 1.12),
  );
  const toPct = (v: number) => Math.min(100, (v / scaleMax) * 100);

  return (
    <div className="bg-surface-card border border-line-subtle rounded-card p-4">
      <h2 className="text-[15px] font-semibold text-ink-primary">{t("cplTitle")}</h2>
      <p className="text-[12px] text-ink-secondary mt-1 leading-relaxed max-w-[64ch]">{t("cplSubtitle")}</p>

      <div className="grid grid-cols-[minmax(150px,1fr)_2fr_100px] gap-3 mt-4 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.045em] text-ink-tertiary">
        <span>{t("product")}</span>
        <span>{t("costPerLead", { currency })}</span>
        <span className="text-end">{t("marginPerLead")}</span>
      </div>

      <div className="flex flex-col gap-px">
        {products.map((p) => {
          const negative = p.margin_per_lead < 0;
          const solid = negative ? p.break_even_cpl : p.cpl;
          const gapFrom = negative ? p.break_even_cpl : p.cpl;
          const gapTo = negative ? p.cpl : p.break_even_cpl;
          return (
            <div
              key={p.product_id}
              className={`grid grid-cols-[minmax(150px,1fr)_2fr_100px] gap-3 items-center py-2 rounded-[6px] ${
                negative ? "bg-critical-bg/50" : ""
              }`}
            >
              <span className="text-[13px] font-semibold text-ink-primary leading-tight" dir="auto">
                {p.product_name}
              </span>

              <div className="relative h-[26px]">
                <div
                  className={`absolute inset-y-[2px] start-0 rounded-s-[3px] ${negative ? "bg-critical" : "bg-brand-pos"}`}
                  style={{ inlineSize: `${toPct(solid)}%` }}
                />
                {/* The margin is a distance you can see, not a number to hold in
                    your head against another number. */}
                <div
                  className="absolute inset-y-[2px] rounded-e-[3px] border border-s-0"
                  style={{
                    insetInlineStart: `${toPct(gapFrom)}%`,
                    inlineSize: `${Math.max(0, toPct(gapTo) - toPct(gapFrom))}%`,
                    background: negative
                      ? "repeating-linear-gradient(135deg,#F3B4B4 0 5px,#FBDCDC 5px 10px)"
                      : "repeating-linear-gradient(135deg,#CDECD9 0 5px,#E4F5EB 5px 10px)",
                    borderColor: negative ? "#EC9A9A" : "#BBE3CC",
                  }}
                />
                <span className="absolute top-[5px] start-2 text-[11.5px] font-bold text-white tabular-nums z-10">
                  {fmt(p.cpl, 2)}
                </span>
                <div
                  className="absolute -inset-y-px w-[2.5px] bg-ink-primary rounded-[1px] z-20"
                  style={{ insetInlineStart: `${toPct(p.break_even_cpl)}%` }}
                  title={`${t("floor")} ${fmt(p.break_even_cpl, 2)}`}
                />
              </div>

              <div className={`text-end text-[15px] font-bold tabular-nums leading-tight ${negative ? "text-critical" : "text-brand-hover"}`}>
                {signed(p.margin_per_lead)}
                <span className="block text-[11.5px] font-semibold mt-[3px]">
                  {signed(p.profit, 0)} {currency}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-3 pt-3 border-t border-line-subtle text-[11.5px] text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px] bg-brand-pos" /> {t("legendPaid")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-[3px] border"
            style={{ background: "repeating-linear-gradient(135deg,#CDECD9 0 4px,#E4F5EB 4px 8px)", borderColor: "#BBE3CC" }}
          />{" "}
          {t("legendMargin")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-[2.5px] h-3.5 bg-ink-primary rounded-[1px]" /> {t("legendFloor")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-[3px] border"
            style={{ background: "repeating-linear-gradient(135deg,#F3B4B4 0 4px,#FBDCDC 4px 8px)", borderColor: "#EC9A9A" }}
          />{" "}
          {t("legendLoss")}
        </span>
      </div>
    </div>
  );
}

/* ═══════════ 3. Where a delivered order's revenue goes ═══════════ */

export function AdSpendCostStack({
  products,
  meta,
  currency,
}: {
  products: ProductEconomics[];
  meta: EconomicsMeta;
  currency: string;
}) {
  const t = useTranslations("adSpend.economics");

  if (meta.total_delivered === 0) return null;

  const per = (x: number) => x / meta.total_delivered;
  const revenuePerDelivered = per(meta.total_revenue);

  // Non-ad costs are whatever the revenue lost that was not ad spend and not
  // profit; deriving it this way keeps the stack summing to revenue exactly
  // rather than accumulating rounding across five separately-rounded lines.
  const nonAdCosts = meta.total_costs - meta.total_spend;
  const cogsShare = products.reduce((s, p) => s + p.delivered * p.aov, 0);

  const parts = [
    { key: "pub", label: t("costAds"), value: per(meta.total_spend), color: COST_COLORS.pub },
    { key: "other", label: t("costOther"), value: per(nonAdCosts), color: COST_COLORS.cogs },
    { key: "profit", label: t("costProfit"), value: per(meta.total_profit), color: COST_COLORS.profit },
  ].filter((p) => p.value !== 0);

  const adsVsProduct = nonAdCosts > 0 ? meta.total_spend / nonAdCosts : null;

  return (
    <div className="bg-surface-card border border-line-subtle rounded-card p-4">
      <h2 className="text-[15px] font-semibold text-ink-primary">
        {t("stackTitle", { amount: fmt(revenuePerDelivered, 2), currency })}
      </h2>
      <p className="text-[12px] text-ink-secondary mt-1">{t("stackSubtitle")}</p>

      <div className="flex h-[34px] rounded-[6px] overflow-hidden gap-0.5 mt-4">
        {parts.map((p) => {
          const share = revenuePerDelivered > 0 ? (p.value / revenuePerDelivered) * 100 : 0;
          return (
            <div
              key={p.key}
              className="relative h-full min-w-[3px]"
              style={{ inlineSize: `${share}%`, background: p.color }}
              title={`${p.label} — ${fmt(p.value, 2)} ${currency}`}
            >
              {share > 8 && (
                <span className="absolute inset-0 grid place-items-center text-[11.5px] font-bold text-white">
                  {fmt(share, 0)} %
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        {parts.map((p, i) => {
          const share = revenuePerDelivered > 0 ? (p.value / revenuePerDelivered) * 100 : 0;
          return (
            <div
              key={p.key}
              className={`grid grid-cols-[14px_1fr_auto_62px] items-center gap-2.5 py-2 text-[13px] ${
                i > 0 ? "border-t border-line-subtle" : ""
              }`}
            >
              <span className="w-3 h-3 rounded-[3px]" style={{ background: p.color }} />
              <span className="text-ink-primary">{p.label}</span>
              <span className="text-end font-bold tabular-nums text-ink-primary whitespace-nowrap">
                {fmt(p.value, 2)}
                <span className="font-medium text-[11px] text-ink-secondary ms-1">{currency}</span>
              </span>
              <span className="text-end text-[12px] text-ink-secondary tabular-nums">{fmt(share, 1)} %</span>
            </div>
          );
        })}
      </div>

      {adsVsProduct !== null && adsVsProduct > 1 && (
        <div className="flex items-center gap-2 mt-3 px-3 py-2.5 rounded-[10px] bg-warning-bg border border-warning/30 text-[13px] text-ink-primary">
          🔥 <span>{t("adsCostRatio", { ratio: fmt(adsVsProduct, 1) })}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════ 4. Per-product table ═══════════ */

export function AdSpendProductTable({
  products,
  meta,
  currency,
}: {
  products: ProductEconomics[];
  meta: EconomicsMeta;
  currency: string;
}) {
  const t = useTranslations("adSpend.economics");

  function verdict(p: ProductEconomics) {
    if (p.margin_per_lead < 0) {
      const severe = Math.abs(p.profit) > 500;
      return severe ? (
        <span className="inline-flex items-center rounded-[6px] px-2.5 py-1 text-[12px] font-bold bg-critical text-white">
          {t("verdictCut")}
        </span>
      ) : (
        <span className="inline-flex items-center rounded-[6px] px-2.5 py-1 text-[12px] font-bold bg-warning-bg border border-warning/40 text-warning">
          {t("verdictFix")}
        </span>
      );
    }
    if (p.margin_per_lead > 15) {
      return (
        <span className="inline-flex items-center rounded-[6px] px-2.5 py-1 text-[12px] font-bold bg-brand text-white">
          {t("verdictScale")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-[6px] px-2.5 py-1 text-[12px] font-bold bg-surface-card border border-brand-pos text-brand-hover">
        {t("verdictHealthy")}
      </span>
    );
  }

  return (
    <div className="bg-surface-card border border-line-subtle rounded-card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-line-subtle">
        <h2 className="text-[15px] font-semibold text-ink-primary">{t("byProduct")}</h2>
        <p className="text-[12px] text-ink-secondary mt-0.5">{t("byProductSub")}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] min-w-[1080px]">
          <thead>
            <tr className="bg-surface-sunken">
              {[
                t("product"),
                t("spend"),
                t("leads"),
                t("funnel"),
                t("deliveryRate"),
                t("cplPaid"),
                t("floorMax"),
                t("marginPerLead"),
                t("profitCol"),
                t("verdict"),
              ].map((h, i) => (
                <th
                  key={h}
                  className={`px-3 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-ink-secondary border-b border-line-subtle whitespace-nowrap ${
                    i === 0 ? "text-start ps-4" : "text-end"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const negative = p.margin_per_lead < 0;
              return (
                <tr
                  key={p.product_id}
                  className={`border-b border-line-subtle ${negative ? "bg-critical-bg/40" : "hover:bg-surface-hover"}`}
                >
                  <td className="px-3 ps-4 py-3 text-start font-semibold text-ink-primary" dir="auto">
                    {p.product_name}
                  </td>
                  <td className="px-3 py-3 text-end tabular-nums">{fmt(p.spend)}</td>
                  <td className="px-3 py-3 text-end tabular-nums">{fmt(p.leads)}</td>
                  <td className="px-3 py-3 text-end tabular-nums text-ink-secondary whitespace-nowrap">
                    <b className="text-ink-primary">{p.leads}</b> → <b className="text-ink-primary">{p.confirmed}</b> →{" "}
                    <b className="text-ink-primary">{p.delivered}</b>
                  </td>
                  <td className="px-3 py-3 text-end tabular-nums">{pct(p.delivery_rate)}</td>
                  <td className="px-3 py-3 text-end tabular-nums">{fmt(p.cpl, 2)}</td>
                  <td className="px-3 py-3 text-end tabular-nums">{fmt(p.break_even_cpl, 2)}</td>
                  <td className={`px-3 py-3 text-end tabular-nums font-bold ${negative ? "text-critical" : "text-brand-hover"}`}>
                    {signed(p.margin_per_lead)}
                  </td>
                  <td className={`px-3 py-3 text-end tabular-nums font-bold ${negative ? "text-critical" : "text-brand-hover"}`}>
                    {signed(p.profit, 0)}
                    {p.roas !== null && (
                      <span className="block text-[11px] font-medium text-ink-secondary mt-0.5">
                        ROAS {fmt(p.roas, 2)}×
                      </span>
                    )}
                  </td>
                  <td className="px-3 pe-4 py-3 text-end">{verdict(p)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-surface-sunken font-bold">
              <td className="px-3 ps-4 py-3 text-start">{t("total")}</td>
              <td className="px-3 py-3 text-end tabular-nums">{fmt(meta.total_spend)}</td>
              <td className="px-3 py-3 text-end tabular-nums">{fmt(meta.total_leads)}</td>
              <td className="px-3 py-3 text-end tabular-nums text-ink-secondary whitespace-nowrap">
                {meta.total_leads} → {meta.total_confirmed} → {meta.total_delivered}
              </td>
              <td className="px-3 py-3 text-end tabular-nums">
                {meta.total_leads > 0 ? pct(meta.total_delivered / meta.total_leads) : "—"}
              </td>
              <td className="px-3 py-3 text-end tabular-nums">
                {meta.total_leads > 0 ? fmt(meta.total_spend / meta.total_leads, 2) : "—"}
              </td>
              <td className="px-3 py-3 text-end" />
              <td className="px-3 py-3 text-end" />
              <td className={`px-3 py-3 text-end tabular-nums ${meta.total_profit < 0 ? "text-critical" : "text-brand-hover"}`}>
                {signed(meta.total_profit, 0)}
              </td>
              <td className="px-3 pe-4 py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
