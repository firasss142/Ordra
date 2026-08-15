"use client";

import { useState, useCallback, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight, Info, Lock, Pencil, Trash2 } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { ProductEconomics, EconomicsMeta, SpendEntry } from "@/hooks/useAdSpendEconomics";

/**
 * The ad-spend console, rebuilt around one question: can this product afford
 * what we are paying for its leads?
 *
 * The page used to lead with four totals — this week, this month, YTD, cost per
 * confirmation — which say how much was spent but never whether spending it was
 * a good idea. These sections answer that instead: the chain shows what the
 * money turned into, the bars show each product against its own break-even
 * floor, the stack shows where a delivered order's revenue actually goes, and
 * the table turns all of it into a per-product decision.
 *
 * Layout, palette and copy follow prototypes/ad-spend-v3.html, which is the
 * approved design. Colours come from the `ads.*` tokens in globals.css.
 */

/* ─────────────────────────── formatting ─────────────────────────── */

function fmt(n: number, d = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function signed(n: number, d = 2): string {
  return `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), d)}`;
}
function pct(n: number, d = 1): string {
  return `${fmt(n * 100, d)} %`;
}

/* ─────────────────────────── tooltip ─────────────────────────── */

/**
 * A cursor-following tooltip, shared by the bars and the stack.
 *
 * Charts without one force the reader to hold five numbers in their head to
 * compare two bars; the dataviz rule is that an HTML chart ships a hover layer
 * by default. Kept as a single fixed node rather than one per mark so a table
 * of forty rows does not mount forty positioned elements.
 */
function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);

  const show = useCallback((body: ReactNode, e: { clientX: number; clientY: number }) => {
    setTip({ x: e.clientX, y: e.clientY, body });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const node = tip ? (
    <div
      role="tooltip"
      className="fixed z-[60] pointer-events-none rounded-[8px] px-3 py-2.5 text-[12px] text-white shadow-floating max-w-[270px]"
      style={{
        background: "#151A1F",
        // Flipped to the other side of the cursor near the viewport edge, so a
        // tooltip on the last column is never clipped by the window.
        left: Math.min(tip.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1600) - 286),
        top: Math.max(8, tip.y - 12),
        transform: "translateY(-100%)",
      }}
    >
      {tip.body}
    </div>
  ) : null;

  return { show, hide, node };
}

function TipTitle({ children }: { children: ReactNode }) {
  return <div className="font-semibold mb-1.5">{children}</div>;
}
function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 justify-between leading-[1.75]">
      <span className="text-[#C9CDD3]">{label}</span>
      <b className="tabular-nums">{value}</b>
    </div>
  );
}
function TipRule() {
  return <div className="h-px bg-white/15 my-1.5" />;
}

/* ─────────────────────────── sparkline ─────────────────────────── */

/**
 * Lead volume per active day. It is here to answer "is this getting worse?"
 * in the same glance as "is this losing money?" — a losing product with rising
 * volume is a different emergency from a losing product that already stopped.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className="flex-none w-[46px] h-5" />;

  const w = 46;
  const h = 20;
  const pad = 2;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (w - 2 * pad),
    h - pad - ((v - min) / range) * (h - 2 * pad),
  ]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
  const last = pts[pts.length - 1];

  return (
    <svg className="flex-none w-[46px] h-5" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.1} fill={color} stroke="#fff" strokeWidth={1.2} />
    </svg>
  );
}

/** Mean of the last third against the first third — direction, not slope. */
function trendOf(values: number[]): number {
  if (values.length < 4) return 0;
  const t = Math.max(2, Math.round(values.length / 3));
  const head = values.slice(0, t).reduce((a, b) => a + b, 0) / t;
  const tail = values.slice(-t).reduce((a, b) => a + b, 0) / t;
  return (tail - head) / Math.max(head, 1);
}

/** Red when volume is climbing on a product that loses money on every lead. */
function sparkColor(p: ProductEconomics): string {
  const trend = trendOf(p.daily_leads);
  if (p.margin_per_lead < 0) return trend > 0.05 ? "var(--ads-red)" : "var(--ads-orange-ink)";
  return trend > 0.05 ? "var(--ads-green-ink)" : "var(--ads-muted)";
}

/* ─────────────────────────── 1. the chain ─────────────────────────── */

export function AdSpendChain({ meta, currency }: { meta: EconomicsMeta; currency: string }) {
  const t = useTranslations("adSpend.economics");

  const steps = [
    { head: t("spent"), value: fmt(meta.total_spend), unit: currency, sub: t("spentSub") },
    { head: t("leadsReceived"), value: fmt(meta.total_leads), unit: "", sub: t("leadsSub") },
    { head: t("confirmedOrders"), value: fmt(meta.total_confirmed), unit: "", sub: t("confirmedSub") },
    { head: t("deliveredPaid"), value: fmt(meta.total_delivered), unit: "", sub: t("deliveredSub") },
    { head: t("collected"), value: fmt(meta.total_revenue), unit: currency, sub: t("collectedSub") },
    {
      head: t("netProfit"),
      value: fmt(meta.total_profit),
      unit: currency,
      sub: t("netProfitSub"),
      tone: meta.total_profit < 0 ? "bad" : "good",
    },
  ];

  const links = [
    { b: meta.total_leads > 0 ? fmt(meta.total_spend / meta.total_leads, 2) : "—", s: `${currency} / lead` },
    { b: meta.total_leads > 0 ? pct(meta.total_confirmed / meta.total_leads) : "—", s: t("confirmRate") },
    { b: meta.total_confirmed > 0 ? pct(meta.total_delivered / meta.total_confirmed) : "—", s: t("arriveRate") },
    {
      b: meta.total_delivered > 0 ? fmt(meta.total_revenue / meta.total_delivered, 2) : "—",
      s: `${currency} / ${t("perDelivery")}`,
    },
    { b: `− ${fmt(meta.total_costs)} ${currency}`, s: t("ofWhichAds", { amount: fmt(meta.total_spend) }), cost: true },
  ];

  return (
    <div className="bg-surface-card border border-ads-line rounded-card shadow-hover-row px-5 pt-4 pb-[15px] grid grid-cols-2 sm:grid-cols-3 gap-4 [@media(min-width:1400px)]:flex [@media(min-width:1400px)]:flex-wrap [@media(min-width:1400px)]:items-start [@media(min-width:1400px)]:gap-0">
      {steps.map((s, i) => (
        <div key={s.head} className="flex items-start">
          <div className="flex flex-col min-w-[112px]">
            <span className="text-[12.5px] font-semibold text-ads-ink-1 whitespace-nowrap">{s.head}</span>
            <span
              className={`text-[27px] font-bold tracking-[-0.022em] leading-[1.15] mt-[7px] tabular-nums ${
                s.tone === "good" ? "text-ads-green-ink" : s.tone === "bad" ? "text-ads-red-ink" : "text-ads-ink-1"
              }`}
            >
              {s.value}
              {s.unit && <span className="text-[0.46em] font-semibold text-ads-ink-2 ms-1">{s.unit}</span>}
            </span>
            <span className="text-[11.5px] text-ads-ink-2 mt-[3px] whitespace-nowrap">{s.sub}</span>
          </div>

          {/* The link between two steps is the conversion that got you there.
              Below 1400px the row wraps to a grid and the links are dropped
              rather than stacked — a vertical arrow between grid cells points
              at the wrong neighbour. */}
          {links[i] && (
            <div className="hidden [@media(min-width:1400px)]:flex flex-col items-center justify-center px-3 mt-5 min-w-[92px]">
              <span
                className={`rounded-[8px] px-2.5 py-1 text-center border ${
                  links[i].cost
                    ? "bg-ads-red-bg border-ads-red-line text-ads-red-ink"
                    : "bg-surface-card border-ads-line-2 text-ads-ink-1"
                }`}
              >
                <span className="block text-[13.5px] font-bold tabular-nums leading-[1.2]">{links[i].b}</span>
                <span
                  className={`block text-[10.5px] mt-px whitespace-nowrap ${
                    links[i].cost ? "text-ads-red-ink" : "text-ads-ink-2"
                  }`}
                >
                  {links[i].s}
                </span>
              </span>
              <svg
                viewBox="0 0 34 9"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
                className="w-[34px] h-[9px] mt-1.5 text-ads-ink-3 rtl:rotate-180"
              >
                <path d="M0 4.5h29M25 1l4 3.5-4 3.5" />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────── 2. what you pay for a lead vs what it is worth ─────────── */

/** Ticks a reader can do arithmetic against, rather than 0–37.4 in five steps. */
function niceScale(maxValue: number): { max: number; step: number } {
  const raw = Math.max(1, maxValue);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((c) => raw / c <= 4) ?? 10 * pow;
  return { max: Math.ceil(raw / step) * step, step };
}

export function AdSpendCplBars({
  products,
  currency,
  periodLabel,
}: {
  products: ProductEconomics[];
  currency: string;
  periodLabel: string;
}) {
  const t = useTranslations("adSpend.economics");
  const { show, hide, node } = useTooltip();
  const [showTable, setShowTable] = useState(false);
  const [showFormula, setShowFormula] = useState(false);

  const { max: scaleMax, step } = niceScale(
    Math.max(...products.map((p) => Math.max(p.cpl, p.break_even_cpl)), 1) * 1.08,
  );
  const toPct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  const ticks: number[] = [];
  for (let v = 0; v <= scaleMax + 1e-9; v += step) ticks.push(v);

  const floors = products.map((p) => p.break_even_cpl);

  return (
    <div className="bg-surface-card border border-ads-line rounded-card shadow-hover-row px-[18px] py-4">
      <div className="flex items-start gap-2.5 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ads-ink-1">{t("cplTitle")}</h2>
          <p className="text-[12px] text-ads-ink-2 mt-[5px] leading-[1.5] max-w-[64ch]">{t("cplSubtitle")}</p>
        </div>
        <span className="flex-1" />
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFormula((v) => !v)}
            aria-expanded={showFormula}
            aria-label={t("formulaTitle")}
            className="w-[29px] h-[29px] grid place-items-center border border-ads-line-2 rounded-[8px] text-ads-ink-2 bg-surface-card hover:text-ads-ink-1 hover:border-line-strong transition-colors duration-fast"
          >
            <Info size={15} strokeWidth={2} />
          </button>
          {showFormula && (
            <div
              className="absolute end-0 top-[34px] z-40 w-[300px] rounded-[8px] px-3 py-2.5 text-[12px] text-white shadow-floating"
              style={{ background: "#151A1F" }}
            >
              <TipTitle>{t("formulaTitle")}</TipTitle>
              <TipRow label={t("formulaPerLead")} value={t("formulaLine1")} />
              <TipRow label={t("formulaMinus")} value={t("formulaLine2")} />
              <TipRow label={t("formulaMinus")} value={t("formulaLine3")} />
              <TipRule />
              <TipRow
                label={t("formulaEachProduct")}
                value={
                  floors.length
                    ? `${fmt(Math.min(...floors), 2)} → ${fmt(Math.max(...floors), 2)} ${currency}`
                    : "—"
                }
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          className="text-[12.5px] font-semibold text-ads-ink-1 border border-ads-line-2 rounded-[8px] px-3 py-1.5 bg-surface-card hover:border-line-strong hover:bg-surface-sunken transition-colors duration-fast"
        >
          {showTable ? t("hideTable") : t("tableView")}
        </button>
      </div>

      <div className="grid grid-cols-[minmax(190px,260px)_1fr_104px] gap-3.5 mt-4 pb-[7px] text-[10.5px] font-semibold uppercase tracking-[0.045em] text-ads-ink-3">
        <span>{t("product")}</span>
        <span>{t("costPerLead", { currency })}</span>
        <span className="text-end leading-[1.5]">
          {t("marginPerLead")}
          <br />
          {periodLabel}
        </span>
      </div>

      <div className="flex flex-col gap-px">
        {products.map((p) => {
          // No attributed spend is not a CPL of zero. Drawing it as one would
          // paint the product's entire floor as realised margin and rank it
          // first — telling you to scale the one product whose acquisition
          // cost is unknown. It gets the floor marker and nothing else.
          const unknown = p.spend <= 0;
          const negative = !unknown && p.margin_per_lead < 0;
          // Solid bar to whichever comes first, hatched band across the gap:
          // above the floor the band is the margin left, below it the overrun.
          const solid = negative ? p.break_even_cpl : p.cpl;
          const gapFrom = negative ? p.break_even_cpl : p.cpl;
          const gapTo = negative ? p.cpl : p.break_even_cpl;
          const trend = trendOf(p.daily_leads);

          return (
            <div
              key={p.product_id}
              className={`grid grid-cols-[minmax(190px,260px)_1fr_104px] items-center gap-3.5 py-2 rounded-[6px] ${
                negative ? "bg-ads-red-band hover:bg-[#FDEFEF]" : "hover:bg-surface-sunken"
              }`}
              onMouseMove={(e) =>
                show(
                  <>
                    <TipTitle>{p.product_name}</TipTitle>
                    <TipRow label={t("tipYouPay")} value={`${fmt(p.cpl, 2)} ${currency}`} />
                    <TipRow label={t("tipFloor")} value={`${fmt(p.break_even_cpl, 2)} ${currency}`} />
                    <TipRow label={t("marginPerLead")} value={`${signed(p.margin_per_lead)} ${currency}`} />
                    <TipRule />
                    <TipRow label={t("deliveryRate")} value={pct(p.delivery_rate)} />
                    <TipRow
                      label={t("tipVolume")}
                      value={trend > 0.05 ? t("trendUp") : trend < -0.05 ? t("trendDown") : t("trendFlat")}
                    />
                    <TipRow label={t("tipPeriodProfit")} value={`${signed(p.profit, 0)} ${currency}`} />
                  </>,
                  e,
                )
              }
              onMouseLeave={hide}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ProductAvatar
                  imageUrl={p.product_image_url}
                  productName={p.product_name}
                  size={30}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold leading-[1.3] text-ads-ink-1 truncate" dir="auto">
                    {p.product_name}
                  </span>
                  <span className="block text-[11.5px] text-ads-ink-2 mt-0.5 leading-[1.4] tabular-nums">
                    {fmt(p.leads)} {t("leads").toLowerCase()} · {pct(p.delivery_rate)} {t("deliveredSub").toLowerCase()}
                  </span>
                </span>
                <Sparkline values={p.daily_leads} color={sparkColor(p)} />
              </div>

              <div className="relative h-[26px]">
                {unknown ? (
                  // An empty track up to the floor: the ceiling is known, what
                  // is being paid against it is not.
                  <div
                    className="absolute inset-y-[2px] start-0 rounded-[3px] border border-dashed border-ads-line-2 bg-surface-sunken"
                    style={{ inlineSize: `${toPct(p.break_even_cpl)}%` }}
                  />
                ) : (
                  <>
                    <div
                      className={`absolute inset-y-[2px] start-0 rounded-s-[3px] ${negative ? "bg-ads-red" : "bg-ads-green"}`}
                      style={{ inlineSize: `${toPct(solid)}%` }}
                    />
                    {/* The margin is a distance you can see, not a number to
                        hold in your head against another number. */}
                    <div
                      className="absolute inset-y-[2px] rounded-e-[3px] border border-s-0"
                      style={{
                        insetInlineStart: `${toPct(gapFrom)}%`,
                        inlineSize: `${Math.max(0, toPct(gapTo) - toPct(gapFrom))}%`,
                        background: negative ? "var(--ads-hatch-bad)" : "var(--ads-hatch-ok)",
                        borderColor: negative
                          ? "var(--ads-hatch-bad-line)"
                          : "var(--ads-hatch-ok-line)",
                      }}
                    />
                    {toPct(solid) > 12 && (
                      <span className="absolute top-[5px] start-[9px] text-[11.5px] font-bold text-white tabular-nums z-[2]">
                        {fmt(p.cpl, 2)}
                      </span>
                    )}
                  </>
                )}
                <div
                  className="absolute -inset-y-px w-[2.5px] bg-ads-ink-1 rounded-[1px] z-[3]"
                  style={{ insetInlineStart: `${toPct(p.break_even_cpl)}%` }}
                />
              </div>

              {unknown ? (
                <div className="text-end text-[13px] font-semibold text-ads-ink-2 leading-[1.2]">
                  {t("costUnknown")}
                  <em className="block not-italic text-[11.5px] font-medium mt-[3px] tabular-nums">
                    {t("canPayUpTo", { amount: fmt(p.break_even_cpl, 2) })}
                  </em>
                </div>
              ) : (
                <div
                  className={`text-end text-[15px] font-bold tabular-nums leading-[1.2] ${
                    negative ? "text-ads-red-ink" : "text-ads-green-ink"
                  }`}
                >
                  {signed(p.margin_per_lead)}
                  <em className="block not-italic text-[11.5px] font-semibold mt-[3px]">
                    {signed(p.profit, 0)} {currency}
                  </em>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* The axis reuses the row's own grid template rather than a hand-tuned
          margin, so the ticks stay under the bars at every column width. */}
      <div className="grid grid-cols-[minmax(190px,260px)_1fr_104px] gap-3.5 mt-1">
        <span />
        <div className="relative h-[34px] border-t border-ads-line">
          {ticks.map((v) => (
            <i
              key={v}
              className="absolute top-1 text-[11px] text-ads-muted not-italic tabular-nums -translate-x-1/2"
              style={{ insetInlineStart: `${toPct(v)}%` }}
            >
              {fmt(v)}
            </i>
          ))}
          <span className="absolute top-[19px] start-1/2 -translate-x-1/2 text-[11px] text-ads-muted whitespace-nowrap">
            {t("axisCaption", { currency })}
          </span>
        </div>
        <span />
      </div>

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 mt-2 text-[11.5px] text-ads-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[3px] flex-none bg-ads-green" /> {t("legendPaid")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-[3px] border flex-none"
            style={{ background: "var(--ads-hatch-ok)", borderColor: "var(--ads-hatch-ok-line)" }}
          />
          {t("legendMargin")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-[2.5px] h-3.5 bg-ads-ink-1 rounded-[1px] flex-none" /> {t("legendFloor")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 h-3 rounded-[3px] border flex-none"
            style={{ background: "var(--ads-hatch-bad)", borderColor: "var(--ads-hatch-bad-line)" }}
          />
          {t("legendLoss")}
        </span>
      </div>

      {/* Every chart owes a table view: colour and length are not readable to
          everyone, and a figure someone needs to quote should be selectable. */}
      {showTable && (
        <div className="mt-3.5 max-h-[250px] overflow-auto border border-ads-line rounded-[8px]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[t("product"), t("cplPaid"), t("floorMax"), t("marginPerLead"), t("deliveryRate"), t("profitCol")].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`sticky top-0 bg-surface-sunken border-b border-ads-line font-semibold text-[11px] text-ads-ink-2 px-2.5 py-1.5 ${
                        i === 0 ? "text-start" : "text-end"
                      }`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id} className="[&+tr>td]:border-t [&+tr>td]:border-ads-line">
                  <td className="px-2.5 py-1.5 text-start" dir="auto">
                    {p.product_name}
                  </td>
                  <td className="px-2.5 py-1.5 text-end tabular-nums">
                    {p.spend > 0 ? fmt(p.cpl, 2) : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-end tabular-nums">{fmt(p.break_even_cpl, 2)}</td>
                  <td className="px-2.5 py-1.5 text-end tabular-nums">
                    {p.spend > 0 ? signed(p.margin_per_lead) : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-end tabular-nums">{pct(p.delivery_rate)}</td>
                  <td className="px-2.5 py-1.5 text-end tabular-nums">
                    {p.spend > 0 ? signed(p.profit, 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {node}
    </div>
  );
}

/* ─────────── 3. where a delivered order's revenue goes ─────────── */

export function AdSpendCostStack({ meta, currency }: { meta: EconomicsMeta; currency: string }) {
  const t = useTranslations("adSpend.economics");
  const { show, hide, node } = useTooltip();

  if (meta.total_delivered === 0) return null;

  const per = (x: number) => x / meta.total_delivered;
  const revenuePerDelivered = per(meta.total_revenue);
  if (revenuePerDelivered <= 0) return null;

  const costs = [
    { key: "pub", label: t("costAds"), value: per(meta.total_spend), color: "var(--ads-pub)" },
    { key: "cogs", label: t("costCogs"), value: per(meta.cost_cogs), color: "var(--ads-cogs)" },
    { key: "delivery", label: t("costDelivery"), value: per(meta.cost_delivery), color: "var(--ads-delivery)" },
    { key: "returns", label: t("costReturns"), value: per(meta.cost_returns), color: "var(--ads-returns)" },
    {
      key: "packing",
      label: t("costPacking"),
      value: per(meta.cost_packing + meta.cost_processing),
      color: "var(--ads-packing)",
    },
  ];

  // A losing cohort spends more than the order brought in, so the segments no
  // longer fit inside the revenue. Rather than let the bar overflow past 100%
  // — or quietly drop the negative profit — the overhang becomes its own red
  // segment and the bar is scaled to total cost. The red part IS the shortfall.
  const profitPerDelivered = per(meta.total_profit);
  const inLoss = profitPerDelivered < 0;
  const costTotal = costs.reduce((s, c) => s + c.value, 0);
  const total = inLoss ? costTotal : revenuePerDelivered;

  const parts = [
    ...costs,
    inLoss
      ? { key: "loss", label: t("costLoss"), value: -profitPerDelivered, color: "var(--ads-red)" }
      : { key: "profit", label: t("costProfit"), value: profitPerDelivered, color: "var(--ads-profit)" },
  ].filter((p) => p.value > 0);

  const adsVsProduct = meta.cost_cogs > 0 ? meta.total_spend / meta.cost_cogs : null;

  return (
    <div className="bg-surface-card border border-ads-line rounded-card shadow-hover-row px-[18px] py-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.005em] text-ads-ink-1">
        {t("stackTitle", { amount: fmt(revenuePerDelivered, 2), currency })}
      </h2>
      <p className="text-[12px] text-ads-ink-2 mt-[5px] leading-[1.5]">{t("stackSubtitle")}</p>

      <div className="flex h-[34px] rounded-[6px] overflow-hidden gap-0.5 mt-4">
        {parts.map((p) => {
          const share = (p.value / total) * 100;
          return (
            <div
              key={p.key}
              className="relative h-full min-w-[3px]"
              style={{ inlineSize: `${share}%`, background: p.color }}
              onMouseMove={(e) =>
                show(
                  <>
                    <TipTitle>{p.label}</TipTitle>
                    <TipRow label={t("tipPerDelivered")} value={`${fmt(p.value, 2)} ${currency}`} />
                    <TipRow label={t("tipShareOfRevenue")} value={pct(p.value / revenuePerDelivered)} />
                  </>,
                  e,
                )
              }
              onMouseLeave={hide}
            >
              {share > 7 && (
                <span className="absolute inset-0 grid place-items-center text-[11.5px] font-bold text-white tabular-nums">
                  {fmt(share, 0)} %
                </span>
              )}
            </div>
          );
        })}
      </div>

      {inLoss && (
        <p className="text-[11.5px] text-ads-red-ink mt-1.5">
          {t("stackOverspend", { amount: `${fmt(costTotal, 2)} ${currency}` })}
        </p>
      )}

      <div className="mt-2">
        {parts.map((p, i) => {
          const closing = p.key === "profit" || p.key === "loss";
          return (
            <div
              key={p.key}
              className={`grid grid-cols-[14px_1fr_auto_62px] items-center gap-[11px] py-2 text-[13px] ${
                i > 0 ? "border-t border-ads-line" : ""
              } ${closing ? "border-t-[1.5px] border-ads-line-2 font-bold" : ""}`}
            >
              <span className="w-3 h-3 rounded-[3px]" style={{ background: p.color }} />
              <span className="text-ads-ink-1">{p.label}</span>
              <span
                className={`text-end font-bold tabular-nums whitespace-nowrap ${
                  p.key === "profit"
                    ? "text-ads-green-ink text-[14px]"
                    : p.key === "loss"
                      ? "text-ads-red-ink text-[14px]"
                      : "text-ads-ink-1"
                }`}
              >
                {p.key === "loss" ? `− ${fmt(p.value, 2)}` : fmt(p.value, 2)}
                <span className="font-medium text-[11px] text-ads-ink-2 ms-[3px]">{currency}</span>
              </span>
              <span className="text-end text-[12px] text-ads-ink-2 tabular-nums">
                {pct(p.value / revenuePerDelivered)}
              </span>
            </div>
          );
        })}
      </div>

      {adsVsProduct !== null && adsVsProduct > 1 && (
        <div className="flex items-center gap-2.5 mt-3.5 px-3 py-[11px] rounded-[10px] bg-[#FFF7ED] border border-[#FBD9A5] text-[13px] text-ads-ink-1">
          🔥 <span>{t("adsCostRatio", { ratio: fmt(adsVsProduct, 1) })}</span>
        </div>
      )}

      {node}
    </div>
  );
}

/* ─────────────────────────── 4. per-product table ─────────────────────────── */

function Verdict({ p }: { p: ProductEconomics }) {
  const t = useTranslations("adSpend.economics");
  const base = "inline-flex items-center gap-1.5 rounded-[6px] px-[11px] py-[5px] text-[12px] font-bold";

  // No attributed spend means no verdict is available. Saying "Scaler" here —
  // which the margin alone would produce, since it equals the entire floor —
  // recommends raising budget on a product whose cost per lead is unknown.
  if (p.spend <= 0) {
    return (
      <span className={`${base} bg-surface-card border border-ads-line-2 text-ads-ink-2`}>
        {t("verdictNoData")}
      </span>
    );
  }

  if (p.margin_per_lead < 0) {
    // Cut when the bleeding is large in absolute terms OR still accelerating;
    // fix when it is small and steady, which is a bid problem, not a product
    // problem.
    const severe = Math.abs(p.profit) > 0.15 * Math.max(p.revenue, 1) || trendOf(p.daily_leads) > 0.05;
    return severe ? (
      <span className={`${base} bg-ads-red text-white`}>{t("verdictCut")}</span>
    ) : (
      <span className={`${base} bg-ads-orange-bg border border-ads-orange-line text-ads-orange-ink`}>
        <Pencil size={12} strokeWidth={2} />
        {t("verdictFix")}
      </span>
    );
  }
  // Relative rather than an absolute dinar threshold: the same page serves
  // Tunisia and Libya, and "15 per lead" means different things in each.
  if (p.margin_per_lead > 0.4 * p.break_even_cpl) {
    return <span className={`${base} bg-ads-green-ink text-white`}>{t("verdictScale")}</span>;
  }
  return (
    <span className={`${base} bg-surface-card border border-ads-green text-ads-green-ink`}>{t("verdictHealthy")}</span>
  );
}

function BreakEvenLever({ p, currency }: { p: ProductEconomics; currency: string }) {
  const t = useTranslations("adSpend.economics");
  if (p.margin_per_lead >= 0) return <span className="text-ads-ink-3">—</span>;

  const pill =
    "inline-flex items-center border border-ads-orange-line bg-[#FFFBF0] text-ads-orange-ink rounded-[6px] px-[9px] py-1 text-[11.5px] font-bold tabular-nums";

  // Two ways back to zero: pay less per lead, or deliver more of them. Show
  // whichever is the smaller relative move, because that is the one someone
  // might actually achieve.
  const cplCut = p.cpl > 0 ? (p.cpl - p.break_even_cpl) / p.cpl : Infinity;
  const drLift =
    p.break_even_delivery_rate !== null && p.delivery_rate > 0
      ? (p.break_even_delivery_rate - p.delivery_rate) / p.delivery_rate
      : Infinity;

  if (drLift < cplCut) {
    return (
      <span className={pill} title={t("leverDeliveryNow", { rate: pct(p.delivery_rate) })}>
        {t("leverDelivery", { rate: pct(p.break_even_delivery_rate ?? 0) })}
      </span>
    );
  }
  return (
    <span className={pill} title={t("leverCplNow", { cpl: fmt(p.cpl, 2) })}>
      {t("leverCpl", { cpl: `${fmt(p.break_even_cpl, 2)} ${currency}` })}
    </span>
  );
}

function CampaignRows({
  entries,
  currency,
  leads,
  colSpan,
  onEdit,
  onDelete,
}: {
  entries: SpendEntry[];
  currency: string;
  leads: number | null;
  colSpan: number;
  onEdit?: (entryId: string) => void;
  onDelete?: (entryId: string) => void;
}) {
  const t = useTranslations("adSpend.economics");

  return (
    <tr>
      <td colSpan={colSpan} className="p-0 ps-[42px] bg-[#FBFCFD] border-b border-ads-line">
        {entries.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-ads-ink-2">{t("noCampaigns")}</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="[&+tr>td]:border-t [&+tr>td]:border-ads-line">
                  <td className="px-3 py-2.5 text-start text-ads-ink-1">
                    <span className="font-medium">{e.label ?? t("manualEntry")}</span>
                    <span className="block text-[11px] text-ads-ink-3">
                      {e.campaign_id ?? `${e.period_start} → ${e.period_end}`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-ads-ink-2 whitespace-nowrap">
                    {fmt(e.amount)} {currency}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums text-ads-ink-2 whitespace-nowrap">
                    {leads !== null && leads > 0 ? `CPL ${fmt(e.amount / leads, 2)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-end text-ads-ink-2 whitespace-nowrap">
                    {e.editable ? (
                      <span className="inline-flex items-center gap-1.5">
                        {onEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(e.id)}
                            aria-label={t("edit")}
                            className="p-1 rounded-[4px] hover:bg-surface-selected hover:text-ads-ink-1 transition-colors duration-fast"
                          >
                            <Pencil size={13} strokeWidth={1.7} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            type="button"
                            onClick={() => onDelete(e.id)}
                            aria-label={t("delete")}
                            className="p-1 rounded-[4px] hover:bg-status-criticalBg hover:text-ads-red-ink transition-colors duration-fast"
                          >
                            <Trash2 size={13} strokeWidth={1.7} />
                          </button>
                        )}
                      </span>
                    ) : (
                      // Synced rows are rewritten by the next run, so offering
                      // an edit button here would promise something the cron
                      // takes back within the hour.
                      <span className="inline-flex items-center gap-1.5 text-ads-ink-3" title={t("syncedReadOnly")}>
                        <Lock size={12} strokeWidth={1.8} />
                        {t("synced")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  );
}

export function AdSpendProductTable({
  products,
  meta,
  currency,
  onEditEntry,
  onDeleteEntry,
  onMapCampaigns,
}: {
  products: ProductEconomics[];
  meta: EconomicsMeta;
  currency: string;
  onEditEntry?: (entryId: string) => void;
  onDeleteEntry?: (entryId: string) => void;
  onMapCampaigns?: () => void;
}) {
  const t = useTranslations("adSpend.economics");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const columns: { label: string; sub?: string }[] = [
    { label: t("product") },
    { label: t("spend"), sub: currency },
    { label: t("leads") },
    { label: t("funnel"), sub: t("funnelSub") },
    { label: t("deliveryRate"), sub: t("deliveryRateSub") },
    { label: t("cplPaid"), sub: currency },
    { label: t("floorMax"), sub: currency },
    { label: t("marginPerLead"), sub: currency },
    { label: t("profitCol"), sub: `${currency} (ROAS)` },
    { label: t("breakEvenLever"), sub: t("breakEvenLeverSub") },
    { label: t("verdict") },
  ];
  const colSpan = columns.length;
  const hasUnmapped = meta.unmapped.spend > 0;

  return (
    <div className="bg-surface-card border border-ads-line rounded-card shadow-hover-row overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap px-[18px] pt-[15px] pb-[13px] border-b border-ads-line">
        <div>
          <h2 className="text-[15px] font-semibold text-ads-ink-1">{t("byProduct")}</h2>
          <p className="text-[12px] text-ads-ink-2 mt-[3px]">{t("byProductSub")}</p>
        </div>
        <span className="flex-1" />
        {onMapCampaigns && (
          <button
            type="button"
            onClick={onMapCampaigns}
            className="inline-flex items-center gap-2 border border-ads-line-2 rounded-[8px] px-3 py-[7px] text-[13px] font-semibold bg-surface-card text-ads-ink-1 hover:border-line-strong transition-colors duration-fast"
          >
            {t("mapCampaigns")}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] min-w-[1360px]">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.label}
                  className={`bg-surface-sunken border-b border-ads-line px-[13px] py-2.5 align-bottom text-[10.5px] font-semibold uppercase tracking-[0.04em] text-ads-ink-2 leading-[1.45] whitespace-nowrap ${
                    i === 0 ? "text-start ps-[18px]" : "text-end"
                  } ${i === columns.length - 1 ? "pe-[18px]" : ""}`}
                >
                  {c.label}
                  {c.sub && (
                    <small className="block text-[10px] normal-case tracking-normal text-ads-ink-3 font-medium">
                      {c.sub}
                    </small>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {products.map((p) => {
              const unknown = p.spend <= 0;
              const negative = !unknown && p.margin_per_lead < 0;
              const isOpen = !!open[p.product_id];
              return [
                <tr
                  key={p.product_id}
                  onClick={() => toggle(p.product_id)}
                  className={`border-b border-ads-line cursor-pointer ${
                    negative ? "bg-ads-red-band hover:bg-[#FDEFEF]" : "hover:bg-surface-sunken"
                  }`}
                >
                  <td className="px-[13px] ps-[18px] py-[11px] text-start">
                    <div className="flex items-center gap-2.5">
                      <ChevronRight
                        size={16}
                        strokeWidth={2.4}
                        aria-hidden="true"
                        // One class or the other, never both: two `rtl:` rotate
                        // utilities on the same element resolve by stylesheet
                        // order, which is not something to rely on.
                        className={`flex-none text-ads-ink-3 transition-transform duration-fast ${
                          isOpen ? "rotate-90" : "rtl:rotate-180"
                        }`}
                      />
                      {/* The names are long Arabic strings that truncate to
                          near-identical prefixes — three boxing dolls differing
                          only in the size word. The thumbnail is what makes a
                          row identifiable at a glance. */}
                      <ProductAvatar
                        imageUrl={p.product_image_url}
                        productName={p.product_name}
                        size={34}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-[1.3] text-ads-ink-1" dir="auto">
                          {p.product_name}
                        </span>
                        <span className="block text-[11.5px] text-ads-ink-2 mt-0.5">
                          {p.entries.length > 0
                            ? t("campaignCount", { count: p.entries.length })
                            : t("noCampaignsShort")}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums">{fmt(p.spend)}</td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums">{fmt(p.leads)}</td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums text-ads-ink-2 whitespace-nowrap">
                    <b className="text-ads-ink-1 font-semibold">{p.leads}</b> →{" "}
                    <b className="text-ads-ink-1 font-semibold">{p.confirmed}</b> →{" "}
                    <b className="text-ads-ink-1 font-semibold">{p.delivered}</b>
                  </td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums">{pct(p.delivery_rate)}</td>
                  {/* An em dash, not 0,00. A zero here is a measurement nobody
                      took, and printing it as a number invites the reader to
                      do arithmetic with it. */}
                  <td
                    className={`px-[13px] py-[11px] text-end tabular-nums ${unknown ? "text-ads-ink-3" : ""}`}
                  >
                    {unknown ? "—" : fmt(p.cpl, 2)}
                  </td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums">{fmt(p.break_even_cpl, 2)}</td>
                  <td
                    className={`px-[13px] py-[11px] text-end tabular-nums text-[14px] font-bold ${
                      unknown ? "text-ads-ink-3 font-medium" : negative ? "text-ads-red-ink" : "text-ads-green-ink"
                    }`}
                  >
                    {unknown ? "—" : signed(p.margin_per_lead)}
                  </td>
                  <td
                    className={`px-[13px] py-[11px] text-end tabular-nums text-[14px] font-bold ${
                      unknown ? "text-ads-ink-3 font-medium" : negative ? "text-ads-red-ink" : "text-ads-green-ink"
                    }`}
                  >
                    {unknown ? "—" : signed(p.profit, 0)}
                    {!unknown && p.roas !== null && (
                      <div className="text-[11px] font-medium text-ads-ink-2 mt-0.5">ROAS {fmt(p.roas, 2)}×</div>
                    )}
                  </td>
                  <td className="px-[13px] py-[11px] text-end">
                    <BreakEvenLever p={p} currency={currency} />
                  </td>
                  <td className="px-[13px] pe-[18px] py-[11px] text-end">
                    <Verdict p={p} />
                  </td>
                </tr>,
                isOpen ? (
                  <CampaignRows
                    key={`${p.product_id}-campaigns`}
                    entries={p.entries}
                    currency={currency}
                    leads={p.leads}
                    colSpan={colSpan}
                    onEdit={onEditEntry}
                    onDelete={onDeleteEntry}
                  />
                ) : null,
              ];
            })}

            {/* Market-level spend is not hidden from the P&L just because no
                one has attributed it yet — it gets a row of its own, and every
                derived column stays blank rather than guessing. */}
            {hasUnmapped && (
              <>
                <tr
                  onClick={() => toggle("__unmapped")}
                  className="border-b border-ads-line cursor-pointer hover:bg-surface-sunken"
                >
                  <td className="px-[13px] ps-[18px] py-[11px] text-start">
                    <div className="flex items-center gap-2.5">
                      <ChevronRight
                        size={16}
                        strokeWidth={2.4}
                        aria-hidden="true"
                        className={`flex-none text-ads-ink-3 transition-transform duration-fast ${
                          open.__unmapped ? "rotate-90" : "rtl:rotate-180"
                        }`}
                      />
                      {/* Holds the thumbnail column open so this row's name
                          starts on the same line as every product above it. */}
                      <span
                        aria-hidden
                        className="flex-none grid place-items-center rounded-md border border-dashed border-ads-line-2 bg-surface-sunken text-ads-ink-3"
                        style={{ width: 34, height: 34 }}
                      >
                        <AlertTriangle size={15} strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-[1.3] text-ads-ink-1">
                          {t("unmappedRow")}
                        </span>
                        <span className="block text-[11.5px] text-ads-ink-2 mt-0.5">
                          {t("campaignCount", { count: meta.unmapped.entries.length })}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-[13px] py-[11px] text-end tabular-nums">{fmt(meta.unmapped.spend)}</td>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <td key={i} className="px-[13px] py-[11px] text-end text-ads-ink-3">
                      —
                    </td>
                  ))}
                  <td className="px-[13px] py-[11px] text-end">
                    <span className="inline-flex items-center border border-ads-orange-line bg-[#FFFBF0] text-ads-orange-ink rounded-[6px] px-[9px] py-1 text-[11.5px] font-bold">
                      {t("leverAttach")}
                    </span>
                  </td>
                  <td className="px-[13px] pe-[18px] py-[11px] text-end">
                    <span className="inline-flex items-center rounded-[6px] px-[11px] py-[5px] text-[12px] font-bold bg-surface-card border border-ads-orange-line text-ads-orange-ink">
                      {t("verdictAttach")}
                    </span>
                  </td>
                </tr>
                {open.__unmapped && (
                  <CampaignRows
                    entries={meta.unmapped.entries}
                    currency={currency}
                    leads={null}
                    colSpan={colSpan}
                    onEdit={onEditEntry}
                    onDelete={onDeleteEntry}
                  />
                )}
              </>
            )}
          </tbody>

          <tfoot>
            <tr className="bg-surface-sunken border-t-[1.5px] border-ads-line-2 font-bold">
              <td className="px-[13px] ps-[18px] py-3 text-start">{t("total")}</td>
              <td className="px-[13px] py-3 text-end tabular-nums">{fmt(meta.total_spend)}</td>
              <td className="px-[13px] py-3 text-end tabular-nums">{fmt(meta.total_leads)}</td>
              <td className="px-[13px] py-3 text-end tabular-nums text-ads-ink-2 whitespace-nowrap">
                <b className="text-ads-ink-1">{fmt(meta.total_leads)}</b> →{" "}
                <b className="text-ads-ink-1">{fmt(meta.total_confirmed)}</b> →{" "}
                <b className="text-ads-ink-1">{fmt(meta.total_delivered)}</b>
              </td>
              <td className="px-[13px] py-3 text-end tabular-nums">
                {meta.total_leads > 0 ? pct(meta.total_delivered / meta.total_leads) : "—"}
              </td>
              <td className="px-[13px] py-3 text-end tabular-nums">
                {meta.total_leads > 0 ? fmt(meta.total_spend / meta.total_leads, 2) : "—"}
              </td>
              <td className="px-[13px] py-3 text-end tabular-nums">
                {meta.total_leads > 0
                  ? fmt((meta.total_revenue - (meta.total_costs - meta.total_spend)) / meta.total_leads, 2)
                  : "—"}
              </td>
              <td
                className={`px-[13px] py-3 text-end tabular-nums text-[14px] ${
                  meta.total_profit < 0 ? "text-ads-red-ink" : "text-ads-green-ink"
                }`}
              >
                {meta.total_leads > 0 ? signed(meta.total_profit / meta.total_leads) : "—"}
              </td>
              <td
                className={`px-[13px] py-3 text-end tabular-nums text-[14px] ${
                  meta.total_profit < 0 ? "text-ads-red-ink" : "text-ads-green-ink"
                }`}
              >
                {signed(meta.total_profit, 0)}
                {meta.total_spend > 0 && (
                  <div className="text-[11px] font-medium text-ads-ink-2 mt-0.5">
                    ROAS {fmt(meta.total_revenue / meta.total_spend, 2)}×
                  </div>
                )}
              </td>
              <td className="px-[13px] py-3" />
              <td className="px-[13px] pe-[18px] py-3" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ─────────────────────────── unmapped banner ─────────────────────────── */

export function AdSpendUnmappedBanner({
  meta,
  currency,
  onAttach,
}: {
  meta: EconomicsMeta;
  currency: string;
  onAttach?: () => void;
}) {
  const t = useTranslations("adSpend.economics");
  if (meta.unmapped.spend <= 0) return null;

  return (
    <div className="flex items-center gap-[11px] px-3.5 py-[11px] rounded-card bg-ads-orange-bg border border-ads-orange-line text-[13.5px] text-ads-ink-1">
      <AlertTriangle size={17} strokeWidth={2} className="flex-none text-ads-orange-ink" />
      <span>
        <b className="font-bold">
          {t("unmappedBanner", {
            amount: `${fmt(meta.unmapped.spend)} ${currency}`,
            count: meta.unmapped.entries.length,
          })}
        </b>{" "}
        {t("unmappedBannerHint")}
      </span>
      <span className="flex-1" />
      {onAttach && (
        <button
          type="button"
          onClick={onAttach}
          className="text-[13px] font-semibold text-ads-orange-ink underline underline-offset-2"
        >
          {t("attach")}
        </button>
      )}
    </div>
  );
}

/* ──────────────── products with no attributed spend ──────────────── */

/**
 * Names the gap rather than leaving it to be inferred from a column of dashes.
 *
 * Two different causes look identical on the page — nobody has mapped the
 * campaign, or the sync has never reached back far enough to see it — and the
 * second one is fixable in one click, so it gets one.
 */
export function AdSpendCoverageBanner({
  meta,
  fromDate,
  onBackfill,
  backfilling,
}: {
  meta: EconomicsMeta;
  fromDate: string;
  onBackfill?: () => void;
  backfilling?: boolean;
}) {
  const t = useTranslations("adSpend.economics");
  if (meta.products_without_spend <= 0) return null;

  return (
    <div className="flex items-center gap-[11px] px-3.5 py-[11px] rounded-card bg-ads-orange-bg border border-ads-orange-line text-[13.5px] text-ads-ink-1">
      <AlertTriangle size={17} strokeWidth={2} className="flex-none text-ads-orange-ink" />
      <span>
        <b className="font-bold">{t("coverageTitle", { count: meta.products_without_spend })}</b>{" "}
        {t("coverageHint")}
      </span>
      <span className="flex-1" />
      {onBackfill && (
        <button
          type="button"
          onClick={onBackfill}
          disabled={backfilling}
          className="text-[13px] font-semibold text-ads-orange-ink underline underline-offset-2 disabled:opacity-60 whitespace-nowrap"
        >
          {backfilling ? t("backfilling") : t("backfillFrom", { date: fromDate })}
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── sync health strip ─────────────────────────── */

export interface SyncHealth {
  lastSyncedAt: string | null;
  rowsWritten: number | null;
  campaigns: number | null;
  cadenceLabel: string | null;
  accounts: { label: string; ok: boolean; detail: string; note: string }[];
  lastError: string | null;
}

/**
 * A silent sync failure must never read as "you spent nothing". This strip is
 * the difference between the two, and it is deliberately present even before
 * Meta is connected — "not connected" is the single most useful thing it can
 * say right now.
 */
export function AdSpendSyncStrip({ health }: { health: SyncHealth }) {
  const t = useTranslations("adSpend.economics");

  const cells = [
    {
      label: t("syncLast"),
      value: health.lastSyncedAt ?? t("syncNever"),
      dot: health.lastSyncedAt ? "var(--ads-green)" : "#F59E0B",
      muted: false,
      note:
        health.rowsWritten !== null && health.campaigns !== null
          ? t("syncRows", { rows: health.rowsWritten, campaigns: health.campaigns })
          : t("syncNoRuns"),
    },
    {
      label: t("syncNext"),
      value: health.cadenceLabel ?? "—",
      dot: null,
      muted: !health.cadenceLabel,
      note: health.cadenceLabel ? t("syncWindow") : t("syncNotScheduled"),
    },
    ...health.accounts.map((a) => ({
      label: a.label,
      value: a.detail,
      dot: a.ok ? "var(--ads-green)" : "#F59E0B",
      muted: false,
      note: a.note,
    })),
    {
      label: t("syncLastError"),
      // "Aucune" is good news and reads muted; a real message must not.
      value: health.lastError ?? t("syncNoError"),
      dot: health.lastError ? "var(--ads-red)" : null,
      muted: !health.lastError,
      note: t("syncErrorWindow"),
    },
  ];

  return (
    <div className="bg-surface-card border border-ads-line rounded-card shadow-hover-row flex flex-wrap">
      {cells.map((c, i) => (
        <div
          key={`${c.label}-${i}`}
          className={`flex-1 min-w-[166px] px-[18px] py-3 flex flex-col gap-0.5 ${
            i > 0 ? "border-s border-ads-line" : ""
          }`}
        >
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ads-ink-2">{c.label}</span>
          <span
            className={`text-[13.5px] flex items-center gap-1.5 tabular-nums ${
              c.muted ? "font-medium text-ads-ink-2" : "font-semibold text-ads-ink-1"
            }`}
          >
            {c.dot && <span className="w-[7px] h-[7px] rounded-full flex-none" style={{ background: c.dot }} />}
            {c.value}
          </span>
          <span className="text-[11.5px] text-ads-ink-2">{c.note}</span>
        </div>
      ))}
    </div>
  );
}
