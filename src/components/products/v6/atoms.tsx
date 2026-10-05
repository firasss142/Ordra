"use client";

// Produits & marges — the prototype's small pieces (prototypes/finances-produits-v1.html):
// the figures, spark(), stack(), obar(), cbar(), pimg(), kpi(). Markup and class
// names are the prototype's; styles live in the Finances kit + products-v6.css,
// under `.fin.prd`.

import { useState, type CSSProperties, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { groupDigits, signOf, currencySymbol, NBSP, type UiLocale } from "@/lib/products/format";
import type { CostShare, CostShareKey } from "@/types/product-overview";

export function useUiLocale(): UiLocale {
  return useLocale() === "ar" ? "ar" : "fr";
}

/** A count or a figure: LTR-isolated, tabular. */
export function Num({ value, d = 0 }: { value: number; d?: number }) {
  return (
    <bdi dir="ltr" className="num">
      {signOf(value, d)}
      {groupDigits(value, d)}
    </bdi>
  );
}

/** An amount: « 17 357 د.ل », the currency demoted beside it, sign inside the isolate. */
export function Amount({
  value,
  currency,
  d = 0,
  signed = false,
}: {
  value: number;
  currency: string;
  d?: number;
  signed?: boolean;
}) {
  return (
    <span className="amt">
      <bdi dir="ltr" className="num">
        {signOf(value, d, signed)}
        {groupDigits(value, d)}
      </bdi>
      {NBSP}
      <span className="cur">{currencySymbol(currency)}</span>
    </span>
  );
}

/** A ratio as a percentage: « 55 % » in French, « 55% » in Arabic. */
export function Pct({ value, d = 0 }: { value: number; d?: number }) {
  const locale = useUiLocale();
  return (
    <bdi dir="ltr" className="num">
      {signOf(value * 100, d)}
      {groupDigits(value * 100, d)}
      {locale === "ar" ? "%" : `${NBSP}%`}
    </bdi>
  );
}

/** Orders per day, a line with its last point marked. Mirrored in RTL (.flipx). */
export function Spark({
  values,
  w = 92,
  h = 28,
  color = "#475467",
  tip,
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
  tip?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 7)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark flipx" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" data-tip={tip}>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} fillOpacity=".1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.6" fill={color} />
    </svg>
  );
}

/**
 * The Finances money palette (design-system §4.25), in its fixed order:
 * products · delivery · ads · packaging · (processing) · profit.
 */
export const SHARE_CLASS: Record<CostShareKey, string> = {
  cogs: "k-cogs",
  carrier: "k-ship",
  ads: "k-ads",
  packing: "k-pack",
  processing: "k-proc",
  profit: "k-profit",
};
export const SHARE_ORDER: CostShareKey[] = ["cogs", "carrier", "ads", "packing", "processing", "profit"];

export function orderedShares<T extends { key: string; share: number }>(shares: T[]): T[] {
  return SHARE_ORDER.map((k) => shares.find((s) => s.key === k)).filter((s): s is T => Boolean(s && s.share > 0));
}

/** Where the money goes, as one thin bar (list rows, the edit rail). */
export function StackBar({
  shares,
  tip,
  style,
}: {
  shares: Pick<CostShare, "key" | "share">[];
  tip?: (s: Pick<CostShare, "key" | "share">) => string;
  style?: CSSProperties;
}) {
  return (
    <div className="stk" style={style}>
      {orderedShares(shares).map((s) => (
        <i key={s.key} className={SHARE_CLASS[s.key]} style={{ flex: Math.round(s.share * 1000) }} data-tip={tip?.(s)} />
      ))}
    </div>
  );
}

/** Delivered · failed · on the road, as one bar. */
export function OutcomeBar({
  delivered,
  failed,
  inFlight,
  tips,
  style,
}: {
  delivered: number;
  failed: number;
  inFlight: number;
  tips?: { dlv: string; fail: string; fly: string };
  style?: CSSProperties;
}) {
  return (
    <div className="ob" style={style}>
      <i className="k-dlv" style={{ flex: delivered }} data-tip={tips?.dlv} />
      <i className="k-fail" style={{ flex: failed }} data-tip={tips?.fail} />
      {inFlight ? <i className="k-fly" style={{ flex: inFlight }} data-tip={tips?.fly} /> : null}
    </div>
  );
}

/** The confirmation bar: uploaded out of decided. */
export function ConfBar({ rate, tip, style }: { rate: number; tip?: string; style?: CSSProperties }) {
  return (
    <div className="bar1 k-up" data-tip={tip} style={style}>
      <i style={{ ["--w" as string]: `${(rate * 100).toFixed(1)}%` }} />
    </div>
  );
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return (w[0] ?? "").slice(0, 1) + (w[1] ?? "").slice(0, 1);
}

/** The product medallion: its photo, else its initials. Sized by where it sits (.phero, .ehead, .photo). */
export function Thumb({ src, name, className }: { src: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`pimg${className ? ` ${className}` : ""}`} aria-hidden="true">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage URLs, sized by CSS like the prototype
        <img alt="" src={src} onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** A KPI tile: tinted holder, label, heavy figure, an optional bar, a short sub. */
export function Kpi({
  icon,
  tone,
  label,
  value,
  extra,
  sub,
}: {
  icon: ReactNode;
  tone: string;
  label: ReactNode;
  value: ReactNode;
  extra?: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div className="card kpi">
      <div className="kpi-h">
        <span className={`tk ${tone}`}>{icon}</span>
        {label}
      </div>
      <div className="kpi-v">{value}</div>
      {extra}
      <div className="kpi-s">{sub}</div>
    </div>
  );
}
