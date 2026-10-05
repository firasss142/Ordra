"use client";

import { useState, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight, Info, Link2, Lock, Package, Pencil, Trash2, Zap } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { fmtDay } from "./mapping/format";
import type { ProductEconomics, EconomicsMeta, SpendEntry, CampaignSpend } from "@/hooks/useAdSpendEconomics";

/**
 * The ad-spend console, rebuilt around one question: can this product afford
 * what we are paying for its leads?
 *
 * The chain shows what the money turned into, the bars show each product
 * against its own break-even floor, the stack shows where a delivered order's
 * revenue actually goes, and the table turns all of it into a per-product
 * decision.
 *
 * Look: prototypes/finances-pub-v5.html — the live blocks in the Finances kit,
 * as Produits & marges (classes in ./ad-spend.css under `.fin.ads`). Money
 * colours are the section's (`--m-*`): ad cost is orange everywhere, green is
 * profit.
 */

/* ─────────────────────────── formatting ─────────────────────────── */

/**
 * fr-FR groups with a narrow no-break space (U+202F), which Plus Jakarta Sans
 * draws with no width — « 34707 » instead of « 34 707 ». A plain no-break
 * space reads the same and keeps the figure on one line.
 */
function fmt(n: number, d = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/\u202f/g, "\u00a0");
}
function signed(n: number, d = 2): string {
  return `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), d)}`;
}
function pct(n: number, d = 1): string {
  return `${fmt(n * 100, d)} %`;
}

/* ─────────────────────────── tooltip ─────────────────────────── */

/**
 * A cursor-following tooltip, shared by the bars, the stack and the verdicts.
 * One fixed node rather than one per mark, so a table of forty rows does not
 * mount forty positioned elements. Flipped to the other side of the cursor
 * near the viewport edge.
 */
function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);

  const show = useCallback((body: ReactNode, e: { clientX: number; clientY: number }) => {
    setTip({ x: e.clientX, y: e.clientY, body });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const node = tip ? (
    <div
      role="tooltip"
      className="tip"
      style={{
        left: tip.x + 14 + 300 > vw ? tip.x - 314 : tip.x + 14,
        top: Math.max(8, tip.y - 12),
        transform: "translateY(-100%)",
      }}
    >
      {tip.body}
    </div>
  ) : null;

  return { show, hide, node };
}
type Show = (body: ReactNode, e: { clientX: number; clientY: number }) => void;

function TipTitle({ children }: { children: ReactNode }) {
  return <div className="tt">{children}</div>;
}
function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="trw">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
function TipRule() {
  return <div className="hr" />;
}
function TipNote({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

/* ─────────────────────────── sparkline ─────────────────────────── */

/**
 * Lead volume per active day. It is here to answer "is this getting worse?"
 * in the same glance as "is this losing money?" — a losing product with rising
 * volume is a different emergency from a losing product that already stopped.
 */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <span className="spk" />;

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
    <svg className="spk" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.2} fill={color} stroke="#fff" strokeWidth={1.2} />
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
  if (p.margin_per_lead < 0) return trend > 0.05 ? "var(--bad-dot)" : "var(--warn-dot)";
  return trend > 0.05 ? "var(--good)" : "var(--ink-q)";
}

/** The product's own picture in Produits' tile. */
function Tile({ p, small }: { p: ProductEconomics; small?: boolean }) {
  const size = small ? 32 : 36;
  return (
    <span className={`pimg${small ? " sm" : ""}`}>
      {p.product_image_url ? (
        <ProductAvatar imageUrl={p.product_image_url} productName={p.product_name} size={size} />
      ) : (
        <Package className="ic" aria-hidden />
      )}
    </span>
  );
}

/* ─────────────────────────── 1. the chain ─────────────────────────── */

export function AdSpendChain({ meta, currency }: { meta: EconomicsMeta; currency: string }) {
  const t = useTranslations("adSpend.economics");

  const steps = [
    { head: t("spent"), k: "k-ads", value: fmt(meta.total_spend), unit: currency, sub: t("spentSub") },
    { head: t("leadsReceived"), k: "k-lead", value: fmt(meta.total_leads), unit: "", sub: t("leadsSub") },
    { head: t("confirmedOrders"), k: "k-conf", value: fmt(meta.total_confirmed), unit: "", sub: t("confirmedSub") },
    { head: t("deliveredPaid"), k: "k-dlv", value: fmt(meta.total_delivered), unit: "", sub: t("deliveredSub") },
    { head: t("collected"), k: "k-cash", value: fmt(meta.total_revenue), unit: currency, sub: t("collectedSub") },
    {
      head: t("netProfit"),
      k: "k-profit",
      value: fmt(meta.total_profit),
      unit: currency,
      sub: t("netProfitSub"),
      last: true,
      bad: meta.total_profit < 0,
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
    <div className="card chain">
      {steps.map((s, i) => (
        <div key={s.head} style={{ display: "contents" }}>
          <div className={`step${s.last ? " last" : ""}${s.bad ? " bad" : ""}`}>
            <span className="sh">
              <i className={`sw ${s.k}`} aria-hidden />
              {s.head}
            </span>
            <span className="sv">
              {s.value}
              {s.unit && <span className="cur">{s.unit}</span>}
            </span>
            <span className="sl">{s.sub}</span>
          </div>
          {/* The link between two steps is the conversion that got you there.
              Below 1340px the row wraps to a grid and the links are dropped
              rather than stacked — an arrow between grid cells points at the
              wrong neighbour. */}
          {links[i] && (
            <div className="lnk" aria-hidden={false}>
              <span className={`lk${links[i].cost ? " cost" : ""}`}>
                <b>{links[i].b}</b>
                <span>{links[i].s}</span>
              </span>
              <svg viewBox="0 0 34 9" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
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

  // No attributed spend is not a CPL of zero. Drawing it as one would paint
  // the product's entire floor as realised margin. Those products fold into
  // one line under the bars instead of a « Coût inconnu » bar each.
  const paid = products.filter((p) => p.spend > 0);
  const unpaid = products.filter((p) => p.spend <= 0);

  const { max: scaleMax, step } = niceScale(
    Math.max(...paid.map((p) => Math.max(p.cpl, p.break_even_cpl)), 1) * 1.08,
  );
  const toPct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  const ticks: number[] = [];
  for (let v = 0; v <= scaleMax + 1e-9; v += step) ticks.push(v);

  const floors = products.map((p) => p.break_even_cpl);

  return (
    <>
    <div className="card">
      <div className="chead">
        <div>
          <h2>{t("cplTitle")}</h2>
          <p className="q">{t("cplSubtitle")}</p>
        </div>
        <div className="rt popw">
          <button
            type="button"
            className="ibtn"
            onClick={() => setShowFormula((v) => !v)}
            aria-expanded={showFormula}
            aria-label={t("formulaTitle")}
          >
            <Info className="ic" aria-hidden />
          </button>
          <button type="button" className="btn2 sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            {showTable ? t("hideTable") : t("tableView")}
          </button>
          {showFormula && (
            <div className="pop fx">
              <h4>{t("formulaTitle")}</h4>
              <div className="fxr"><span>{t("formulaPerLead")}</span><b>{t("formulaLine1")}</b></div>
              <div className="fxr"><span>{t("formulaMinus")}</span><b>{t("formulaLine2")}</b></div>
              <div className="fxr"><span>{t("formulaMinus")}</span><b>{t("formulaLine3")}</b></div>
              <div className="fxr hr">
                <span>{t("formulaEachProduct")}</span>
                <b>{floors.length ? `${fmt(Math.min(...floors), 2)} → ${fmt(Math.max(...floors), 2)} ${currency}` : "—"}</b>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bhead bgrid">
        <span>{t("product")}</span>
        <span>{t("costPerLead", { currency })}</span>
        <span className="r">
          {t("marginPerLead")}
          <br />
          {periodLabel}
        </span>
      </div>

      <div className="bars">
        {paid.map((p) => {
          const negative = p.margin_per_lead < 0;
          // Solid bar to whichever comes first, hatched band across the gap:
          // above the floor the band is the margin left, below it the overrun.
          const solid = negative ? p.break_even_cpl : p.cpl;
          const gapFrom = negative ? p.break_even_cpl : p.cpl;
          const gapTo = negative ? p.cpl : p.break_even_cpl;
          const trend = trendOf(p.daily_leads);

          return (
            <div
              key={p.product_id}
              className={`brow bgrid${negative ? " neg" : ""}`}
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
              <span className="bname">
                <Tile p={p} small />
                <span className="txt">
                  <b dir="auto">{p.product_name}</b>
                  <small>
                    {fmt(p.leads)} {t("leads").toLowerCase()} · {pct(p.delivery_rate)} {t("deliveredSub").toLowerCase()}
                  </small>
                </span>
                <Sparkline values={p.daily_leads} color={sparkColor(p)} />
              </span>

              <span className="btrack">
                <span className="bfill" style={{ inlineSize: `${toPct(solid)}%` }} />
                {/* The margin is a distance you can see, not a number to hold
                    in your head against another number. */}
                <span
                  className="bgap"
                  style={{
                    insetInlineStart: `${toPct(gapFrom)}%`,
                    inlineSize: `${Math.max(0, toPct(gapTo) - toPct(gapFrom))}%`,
                  }}
                />
                {toPct(solid) > 20 && <span className="bcap">{fmt(p.cpl, 2)}</span>}
                <span className="bseuil" style={{ insetInlineStart: `${toPct(p.break_even_cpl)}%` }} />
              </span>

              <span className={`bm ${negative ? "bad" : "ok"}`}>
                {signed(p.margin_per_lead)}
                <em>
                  {signed(p.profit, 0)} {currency}
                </em>
              </span>
            </div>
          );
        })}
      </div>

      {unpaid.length > 0 && (
        <div className="nospend" data-nospend>
          <Info className="ic" aria-hidden />
          <span>
            <b>{t("noSpendLine", { count: unpaid.length })}</b>
            {" · "}
            {unpaid
              .map((p) => t("canPayUpToLead", { name: p.product_name, amount: `${fmt(p.break_even_cpl, 2)} ${currency}` }))
              .join(" · ")}
          </span>
        </div>
      )}

      {/* The axis reuses the row's own grid template, so the ticks stay under
          the bars at every column width. */}
      <div className="axrow bgrid">
        <span />
        <div className="axis">
          {ticks.map((v) => (
            <i key={v} style={{ insetInlineStart: `${toPct(v)}%` }}>
              {fmt(v)}
            </i>
          ))}
          <span className="cap">{t("axisCaption", { currency })}</span>
        </div>
        <span />
      </div>

      <div className="leg">
        <span><i className="s paid" />{t("legendPaid")}</span>
        <span><i className="s left" />{t("legendMargin")}</span>
        <span><i className="t" />{t("legendFloor")}</span>
        <span><i className="s over" />{t("legendLoss")}</span>
      </div>

      {/* Every chart owes a table view: colour and length are not readable to
          everyone, and a figure someone needs to quote should be selectable. */}
      {showTable && (
        <div className="tv glass">
          <table>
            <thead>
              <tr>
                {[t("product"), t("cplPaid"), t("floorMax"), t("marginPerLead"), t("deliveryRate"), t("profitCol")].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_id}>
                  <td dir="auto">{p.product_name}</td>
                  <td>{p.spend > 0 ? fmt(p.cpl, 2) : "—"}</td>
                  <td>{fmt(p.break_even_cpl, 2)}</td>
                  <td>{p.spend > 0 ? signed(p.margin_per_lead) : "—"}</td>
                  <td>{pct(p.delivery_rate)}</td>
                  <td>{p.spend > 0 ? signed(p.profit, 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    {node}
    </>
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

  // The section's money order and colours (P&L, Produits): product, delivery,
  // returns (a tint of delivery), ads, packaging — then what is left.
  const costs = [
    { key: "cogs", label: t("costCogs"), value: per(meta.cost_cogs), k: "k-cogs" },
    { key: "delivery", label: t("costDelivery"), value: per(meta.cost_delivery), k: "k-ship" },
    { key: "returns", label: t("costReturns"), value: per(meta.cost_returns), k: "k-ret" },
    { key: "pub", label: t("costAds"), value: per(meta.total_spend), k: "k-ads" },
    { key: "packing", label: t("costPacking"), value: per(meta.cost_packing + meta.cost_processing), k: "k-pack" },
  ];

  const profitPerDelivered = per(meta.total_profit);
  const inLoss = profitPerDelivered < 0;
  const costTotal = costs.reduce((s, c) => s + c.value, 0);
  const total = inLoss ? costTotal : revenuePerDelivered;

  const parts = [
    ...costs,
    inLoss
      ? { key: "loss", label: t("costLoss"), value: -profitPerDelivered, k: "k-loss" }
      : { key: "profit", label: t("costProfit"), value: profitPerDelivered, k: "k-profit" },
  ].filter((p) => p.value > 0);

  const adsVsProduct = meta.cost_cogs > 0 ? meta.total_spend / meta.cost_cogs : null;

  return (
    <>
    <div className="card stack">
      <div className="chead">
        <div>
          <h2>{t("stackTitle", { amount: fmt(revenuePerDelivered, 2), currency })}</h2>
          <p className="q">{t("stackSubtitle")}</p>
        </div>
      </div>

      <div className="stbar">
        {parts.map((p) => {
          const share = (p.value / total) * 100;
          return (
            <i
              key={p.key}
              className={p.k}
              style={{ inlineSize: `${share}%` }}
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
              {share > 7 && <span>{fmt(share, 0)} %</span>}
            </i>
          );
        })}
      </div>

      {inLoss && <p className="overspend">{t("stackOverspend", { amount: `${fmt(costTotal, 2)} ${currency}` })}</p>}

      <ul className="stls">
        {parts.map((p) => {
          const closing = p.key === "profit" || p.key === "loss";
          return (
            <li key={p.key} className={`stl${closing ? " tot" : ""}${p.key === "loss" ? " loss" : ""}`}>
              <i className={`sw ${p.k}`} aria-hidden />
              <span data-label>{p.label}</span>
              <span className="v">
                {p.key === "loss" ? `− ${fmt(p.value, 2)}` : fmt(p.value, 2)}
                <span className="cur">{currency}</span>
              </span>
              <span className="p">{pct(p.value / revenuePerDelivered)}</span>
            </li>
          );
        })}
      </ul>

      {adsVsProduct !== null && adsVsProduct > 1 ? (
        <div className="note warn">
          <span className="nh"><Zap className="ic" aria-hidden /></span>
          <span>{t("adsCostRatio", { ratio: fmt(adsVsProduct, 1) })}</span>
        </div>
      ) : (
        <div className="pad" />
      )}
    </div>
    {node}
    </>
  );
}

/* ─────────────────────────── 4. per-product table ─────────────────────────── */

/** The verdict, and — on hover — the reason for it. */
function Verdict({ p, show, hide }: { p: ProductEconomics; show: Show; hide: () => void }) {
  const t = useTranslations("adSpend.economics");

  let cls: string;
  let label: string;
  let why: string;
  let rows: [string, string][] = [];
  let icon: ReactNode = null;

  if (p.spend <= 0) {
    cls = "v-none";
    label = t("verdictNoData");
    why = t("verdictWhyNoData");
  } else if (p.margin_per_lead < 0) {
    const severe = Math.abs(p.profit) > 0.15 * Math.max(p.revenue, 1) || trendOf(p.daily_leads) > 0.05;
    if (severe) {
      cls = "v-cut";
      label = t("verdictCut");
      why = t("verdictWhyCut");
      rows = [[t("tipLoss"), `${signed(p.profit, 0)}`], [t("tipCollected"), fmt(p.revenue)]];
    } else {
      cls = "v-fix";
      label = t("verdictFix");
      why = t("verdictWhyFix");
      rows = [[t("tipLoss"), `${signed(p.profit, 0)}`]];
      icon = <Pencil className="ic" aria-hidden />;
    }
  } else if (p.margin_per_lead > 0.4 * p.break_even_cpl) {
    cls = "v-scale";
    label = t("verdictScale");
    why = t("verdictWhyScale");
    rows = [[t("marginPerLead"), signed(p.margin_per_lead)], [t("tipFloor"), fmt(p.break_even_cpl, 2)]];
  } else {
    cls = "v-ok";
    label = t("verdictHealthy");
    why = t("verdictWhyHealthy");
    rows = [[t("marginPerLead"), signed(p.margin_per_lead)], [t("tipFloor"), fmt(p.break_even_cpl, 2)]];
  }

  const body = (
    <>
      <TipTitle>{label}</TipTitle>
      {rows.map(([l, v]) => (
        <TipRow key={l} label={l} value={v} />
      ))}
      <TipNote>{why}</TipNote>
    </>
  );

  return (
    <span
      className={`vb ${cls}`}
      onMouseEnter={(e) => show(body, e)}
      onMouseMove={(e) => show(body, e)}
      onMouseLeave={hide}
      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
    >
      {icon}
      {label}
    </span>
  );
}

function BreakEvenLever({ p, currency }: { p: ProductEconomics; currency: string }) {
  const t = useTranslations("adSpend.economics");
  if (p.margin_per_lead >= 0 || p.spend <= 0) return <span className="dim">—</span>;

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
      <span className="tag warn lever" title={t("leverDeliveryNow", { rate: pct(p.delivery_rate) })}>
        {t("leverDelivery", { rate: pct(p.break_even_delivery_rate ?? 0) })}
      </span>
    );
  }
  return (
    <span className="tag warn lever" title={t("leverCplNow", { cpl: fmt(p.cpl, 2) })}>
      {t("leverCpl", { cpl: `${fmt(p.break_even_cpl, 2)} ${currency}` })}
    </span>
  );
}

/**
 * What a product's spend is made of: campaigns → ad sets, then manual entries.
 *
 * Leads cannot be attributed below the product — no order carries a campaign —
 * so a campaign line carries what it can honestly say: the spend charged here,
 * the share of the campaign that is (when it is split), and Meta's own
 * purchase count and cost per purchase, split the same way as the money.
 */
function CampaignRows({
  campaigns,
  entries,
  currency,
  colSpan,
  onEdit,
  onDelete,
  onOpenCampaign,
}: {
  campaigns: CampaignSpend[];
  entries: SpendEntry[];
  currency: string;
  colSpan: number;
  onEdit?: (entryId: string) => void;
  onDelete?: (entryId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
}) {
  const t = useTranslations("adSpend.economics");
  const perPurchase = (amount: number, results: number) =>
    results > 0 ? t("costPerPurchase", { amount: `${fmt(amount / results, 2)} ${currency}` }) : "—";
  const synced = (
    <span className="ro" title={t("syncedReadOnly")}>
      <Lock className="ic" aria-hidden />
      {t("synced")}
    </span>
  );

  return (
    <tr className="camps">
      <td colSpan={colSpan}>
        <div className="cbox">
          {campaigns.length === 0 && entries.length === 0 ? (
            <p>{t("noCampaigns")}</p>
          ) : (
            <table className="c">
              <tbody>
                {campaigns.map((c) => [
                  <tr key={c.campaign_id}>
                    <td>
                      <span className="cl">
                        <span className="kick">{t("campaignLine")}</span>
                        <span className="cn">{c.campaign_name ?? c.campaign_id}</span>
                        <span className={`tag${c.share !== null ? " good" : ""}`}>
                          {c.share === null
                            ? t("shareWhole")
                            : t(c.split === "manual" ? "shareManual" : "shareAuto", { pct: `${fmt(c.share * 100)} %` })}
                        </span>
                        {onOpenCampaign && (
                          <button type="button" className="link" onClick={() => onOpenCampaign(c.campaign_id)}>
                            {t("openInMapping")}
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="amt">
                      {fmt(c.amount)} {currency}
                    </td>
                    <td>
                      {c.results > 0 ? t("metaPurchases", { count: `${c.share !== null ? "≈ " : ""}${fmt(c.results)}` }) : "—"}
                    </td>
                    <td>{perPurchase(c.amount, c.results)}</td>
                    <td>{synced}</td>
                  </tr>,
                  ...c.adsets.map((a) => (
                    <tr key={`${c.campaign_id}-${a.adset_id}`} className="as">
                      <td>
                        <span className="cl">
                          <span className="kick">{t("adsetLine")}</span>
                          <span>{a.adset_name ?? a.adset_id}</span>
                        </span>
                      </td>
                      <td>{fmt(a.amount)}</td>
                      <td>{a.results > 0 ? `${c.share !== null ? "≈ " : ""}${fmt(a.results)}` : "—"}</td>
                      <td>{perPurchase(a.amount, a.results)}</td>
                      <td />
                    </tr>
                  )),
                ])}

                {entries.length > 0 && (
                  <tr className="kh">
                    <td colSpan={5}>
                      <span className="kick">{t("manualLines")}</span>
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="man">{e.label ?? t("manualEntry")}</span>
                      <span className="ci">{e.campaign_id ?? `${e.period_start} → ${e.period_end}`}</span>
                    </td>
                    <td className="amt">
                      {fmt(e.amount)} {currency}
                    </td>
                    <td />
                    <td />
                    <td>
                      {e.editable ? (
                        <>
                          {onEdit && (
                            <button type="button" className="mbtn" onClick={() => onEdit(e.id)} aria-label={t("edit")}>
                              <Pencil className="ic" aria-hidden />
                            </button>
                          )}
                          {onDelete && (
                            <button type="button" className="mbtn del" onClick={() => onDelete(e.id)} aria-label={t("delete")}>
                              <Trash2 className="ic" aria-hidden />
                            </button>
                          )}
                        </>
                      ) : (
                        // Synced rows are rewritten by the next run, so offering
                        // an edit button here would promise something the cron
                        // takes back within the hour.
                        synced
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
  onOpenCampaign,
}: {
  products: ProductEconomics[];
  meta: EconomicsMeta;
  currency: string;
  onEditEntry?: (entryId: string) => void;
  onDeleteEntry?: (entryId: string) => void;
  onMapCampaigns?: () => void;
  /** Open the mapping drawer on one campaign. */
  onOpenCampaign?: (campaignId: string) => void;
}) {
  const t = useTranslations("adSpend.economics");
  const { show, hide, node } = useTooltip();
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
  const chevron = <ChevronRight className="exp" strokeWidth={2.4} aria-hidden />;

  return (
    <>
    <div className="card tcard">
      <div className="chead">
        <div>
          <h2>{t("byProduct")}</h2>
          <p className="q">{t("byProductSub")}</p>
        </div>
        {onMapCampaigns && (
          <div className="rt">
            <button type="button" className="btn2 sm" onClick={onMapCampaigns}>
              <Link2 className="ic" aria-hidden />
              {t("mapCampaigns")}
            </button>
          </div>
        )}
      </div>

      <div className="tscroll">
        <table className="g">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label}>
                  {c.label}
                  {c.sub && <small>{c.sub}</small>}
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
                  className={`prod${negative ? " neg" : ""}${isOpen ? " open" : ""}`}
                >
                  <td>
                    <div className="pcell">
                      {chevron}
                      {/* The names are long Arabic strings that truncate to
                          near-identical prefixes — three boxing dolls differing
                          only in the size word. The picture is what makes a
                          row identifiable at a glance. */}
                      <Tile p={p} />
                      <span>
                        <b dir="auto">{p.product_name}</b>
                        <small>
                          {p.campaigns.length > 0
                            ? t("campaignsCount", { count: p.campaigns.length })
                            : p.entries.length > 0
                              ? t("campaignCount", { count: p.entries.length })
                              : t("noCampaignsShort")}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{unknown ? <span className="dim">—</span> : fmt(p.spend)}</td>
                  <td>{fmt(p.leads)}</td>
                  <td className="fun">
                    <b>{p.leads}</b> → <b>{p.confirmed}</b> → <b>{p.delivered}</b>
                  </td>
                  <td>{pct(p.delivery_rate)}</td>
                  {/* An em dash, not 0,00. A zero here is a measurement nobody
                      took, and printing it as a number invites arithmetic. */}
                  <td>{unknown ? <span className="dim">—</span> : fmt(p.cpl, 2)}</td>
                  <td>{fmt(p.break_even_cpl, 2)}</td>
                  <td className={`big${unknown ? "" : negative ? " bad" : " ok"}`}>
                    {unknown ? <span className="dim">—</span> : signed(p.margin_per_lead)}
                  </td>
                  <td className={`big${unknown ? "" : negative ? " bad" : " ok"}`}>
                    {unknown ? <span className="dim">—</span> : signed(p.profit, 0)}
                    {!unknown && p.roas !== null && <div className="sub2">ROAS {fmt(p.roas, 2)}×</div>}
                  </td>
                  <td>
                    <BreakEvenLever p={p} currency={currency} />
                  </td>
                  <td>
                    <Verdict p={p} show={show} hide={hide} />
                  </td>
                </tr>,
                isOpen ? (
                  <CampaignRows
                    key={`${p.product_id}-campaigns`}
                    campaigns={p.campaigns}
                    entries={p.entries}
                    currency={currency}
                    colSpan={colSpan}
                    onEdit={onEditEntry}
                    onDelete={onDeleteEntry}
                    onOpenCampaign={onOpenCampaign}
                  />
                ) : null,
              ];
            })}

            {/* Market-level spend is not hidden from the P&L just because no
                one has attributed it yet — it gets a row of its own, and every
                derived column stays blank rather than guessing. */}
            {hasUnmapped && (
              <>
                <tr onClick={() => toggle("__unmapped")} className={`prod${open.__unmapped ? " open" : ""}`}>
                  <td>
                    <div className="pcell">
                      {chevron}
                      <span className="pimg dash" aria-hidden>
                        <AlertTriangle className="ic" />
                      </span>
                      <span>
                        <b>{t("unmappedRow")}</b>
                        <small>
                          {meta.unmapped.campaigns.length > 0
                            ? t("campaignsCount", { count: meta.unmapped.campaigns.length })
                            : t("campaignCount", { count: meta.unmapped.entries.length })}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>{fmt(meta.unmapped.spend)}</td>
                  {Array.from({ length: 7 }).map((_, i) => (
                    <td key={i}>
                      <span className="dim">—</span>
                    </td>
                  ))}
                  <td>
                    <span className="tag warn">{t("leverAttach")}</span>
                  </td>
                  <td>
                    <span
                      className="vb v-att"
                      onMouseEnter={(e) => show(<><TipTitle>{t("verdictAttach")}</TipTitle><TipNote>{t("verdictWhyAttach")}</TipNote></>, e)}
                      onMouseMove={(e) => show(<><TipTitle>{t("verdictAttach")}</TipTitle><TipNote>{t("verdictWhyAttach")}</TipNote></>, e)}
                      onMouseLeave={hide}
                    >
                      {t("verdictAttach")}
                    </span>
                  </td>
                </tr>
                {open.__unmapped && (
                  <CampaignRows
                    campaigns={meta.unmapped.campaigns}
                    entries={meta.unmapped.entries}
                    currency={currency}
                    colSpan={colSpan}
                    onEdit={onEditEntry}
                    onDelete={onDeleteEntry}
                    onOpenCampaign={onOpenCampaign}
                  />
                )}
              </>
            )}
          </tbody>

          <tfoot>
            <tr>
              <td>{t("total")}</td>
              <td>{fmt(meta.total_spend)}</td>
              <td>{fmt(meta.total_leads)}</td>
              <td className="fun">
                <b>{fmt(meta.total_leads)}</b> → <b>{fmt(meta.total_confirmed)}</b> → <b>{fmt(meta.total_delivered)}</b>
              </td>
              <td>{meta.total_leads > 0 ? pct(meta.total_delivered / meta.total_leads) : "—"}</td>
              <td>{meta.total_leads > 0 ? fmt(meta.total_spend / meta.total_leads, 2) : "—"}</td>
              <td>
                {meta.total_leads > 0
                  ? fmt((meta.total_revenue - (meta.total_costs - meta.total_spend)) / meta.total_leads, 2)
                  : "—"}
              </td>
              <td className={`big ${meta.total_profit < 0 ? "bad" : "ok"}`}>
                {meta.total_leads > 0 ? signed(meta.total_profit / meta.total_leads) : "—"}
              </td>
              <td className={`big ${meta.total_profit < 0 ? "bad" : "ok"}`}>
                {signed(meta.total_profit, 0)}
                {meta.total_spend > 0 && <div className="sub2">ROAS {fmt(meta.total_revenue / meta.total_spend, 2)}×</div>}
              </td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    {node}
    </>
  );
}

/* ──────────────── the two warnings ──────────────── */

/*
 * Since prototypes/finances-pub-v5.html the warnings live in ONE place: the
 * head of the « Campagnes et produits » drawer, where both are fixed. The
 * banners below are what the page shows only when that drawer does not exist
 * (no Meta account connected) — an alert must never simply disappear.
 */

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
    <div className="note warn">
      <span className="nh"><Link2 className="ic" aria-hidden /></span>
      <span>
        <b>
          {t("unmappedBanner", {
            amount: `${fmt(meta.unmapped.spend)} ${currency}`,
            count: meta.unmapped.campaigns.length + meta.unmapped.entries.length,
          })}
        </b>{" "}
        {t("unmappedBannerHint")}
      </span>
      {onAttach && (
        <button type="button" className="go" onClick={onAttach}>
          {t("attach")}
        </button>
      )}
    </div>
  );
}

/**
 * Names the gap rather than leaving it to be inferred from a column of dashes.
 *
 * Two different causes look identical on the page — nobody has mapped the
 * campaign, or the sync has never reached back far enough to see it — and the
 * second one is fixable in one click, so it gets one. The date is written for
 * a person (« 14 juil. »), not as an ISO string.
 */
function useCoverageText(fromDate: string, backfilling?: boolean) {
  const t = useTranslations("adSpend.economics");
  const locale = useLocale();
  return {
    title: (count: number) => t("coverageTitle", { count }),
    hint: t("coverageHint"),
    action: backfilling ? t("backfilling") : t("backfillFrom", { date: fmtDay(fromDate, locale) }),
  };
}

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
  const text = useCoverageText(fromDate, backfilling);
  if (meta.products_without_spend <= 0) return null;

  return (
    <div className="note warn">
      <span className="nh"><AlertTriangle className="ic" aria-hidden /></span>
      <span>
        <b>{text.title(meta.products_without_spend)}</b> {text.hint}
      </span>
      {onBackfill && (
        <button type="button" className="go" onClick={onBackfill} disabled={backfilling}>
          {text.action}
        </button>
      )}
    </div>
  );
}

/** The same warning, as a line of the drawer's head (classes under `.ads-ov`). */
export function AdSpendCoverageNote({
  count,
  fromDate,
  onBackfill,
  backfilling,
}: {
  count: number;
  fromDate: string;
  onBackfill?: () => void;
  backfilling?: boolean;
}) {
  const text = useCoverageText(fromDate, backfilling);
  if (count <= 0) return null;

  return (
    <div className="dw">
      <span className="nh"><AlertTriangle className="ic" aria-hidden /></span>
      <span>
        <b>{text.title(count)}</b> {text.hint}
      </span>
      {onBackfill && (
        <button type="button" className="go" onClick={onBackfill} disabled={backfilling}>
          {text.action}
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
      dot: health.lastSyncedAt ? "var(--live)" : "var(--warn-dot)",
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
      dot: a.ok ? "var(--live)" : "var(--warn-dot)",
      muted: false,
      note: a.note,
    })),
    {
      label: t("syncLastError"),
      value: health.lastError ?? t("syncNoError"),
      dot: health.lastError ? "var(--bad-dot)" : null,
      muted: !health.lastError,
      note: t("syncErrorWindow"),
    },
  ];

  return (
    <div className="card sync">
      {cells.map((c, i) => (
        <div key={`${c.label}-${i}`} className="sy">
          <span className="eyebrow">{c.label}</span>
          <span className={`sv${c.muted ? " mut" : ""}`}>
            {c.dot && <i style={{ background: c.dot }} />}
            {c.value}
          </span>
          <span className="sn">{c.note}</span>
        </div>
      ))}
    </div>
  );
}
