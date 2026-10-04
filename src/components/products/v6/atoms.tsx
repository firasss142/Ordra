"use client";

// The prototype's small pieces (prototypes/products-v6.html), one component each:
// N(), M(), PC(), spark(), stackBar(), bars(), thumb(), kpi(). Markup and class
// names are the prototype's; styles live in products-v6.css under .pv6.

import { useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { groupDigits, signOf, currencySymbol, NBSP, type UiLocale } from "@/lib/products/format";
import type { CostShare } from "@/types/product-overview";

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

/** An amount: « 17 357 د.ل », sign inside the isolate, never split across lines. */
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
      {currencySymbol(currency)}
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
  w = 96,
  h = 28,
  color = "var(--brand)",
}: {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 6)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark flipx" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={color} fillOpacity=".1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.6" fill={color} />
    </svg>
  );
}

/** The cost-stack hue of each share (design-system §4.21). */
export const SHARE_CLASS: Record<CostShare["key"], string> = {
  carrier: "s-darb",
  cogs: "s-cogs",
  packing: "s-pack",
  processing: "s-proc",
  ads: "s-ads",
  profit: "s-profit",
};

/** Where the money goes, as one thin bar (list rows). */
export function StackBar({ shares, style }: { shares: CostShare[]; style?: React.CSSProperties }) {
  return (
    <div className="stack" aria-hidden="true" style={style}>
      {shares
        .filter((s) => s.share > 0)
        .map((s) => (
          <i key={s.key} className={SHARE_CLASS[s.key]} style={{ flex: Math.round(s.share * 1000) }} />
        ))}
    </div>
  );
}

/** Day-by-day bars on a 600-wide axis; a dashed line where intake stopped. */
export function Bars({
  values,
  color,
  h,
  stopIndex,
}: {
  values: number[];
  color: string;
  h: number;
  stopIndex: number | null;
}) {
  const w = 600;
  const n = Math.max(values.length, 1);
  const bw = w / n;
  const max = Math.max(1, ...values);
  return (
    <svg className="tsvg flipx" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" height={h} aria-hidden="true">
      {values.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 4)) : 0;
        return (
          <rect
            key={i}
            x={(i * bw + 1.5).toFixed(1)}
            y={(h - bh).toFixed(1)}
            width={Math.max(bw - 3, 0.5).toFixed(1)}
            height={bh.toFixed(1)}
            rx="1.5"
            fill={color}
          />
        );
      })}
      <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="var(--line)" />
      {stopIndex !== null ? (
        <line
          x1={((stopIndex + 1) * bw).toFixed(1)}
          y1="0"
          x2={((stopIndex + 1) * bw).toFixed(1)}
          y2={h}
          stroke="var(--call)"
          strokeWidth="1.2"
          strokeDasharray="3 3"
        />
      ) : null}
    </svg>
  );
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return (w[0] ?? "").slice(0, 1) + (w[1] ?? "").slice(0, 1);
}

/** The product photo, else its initials. */
export function Thumb({
  src,
  name,
  size,
  radius,
}: {
  src: string | null;
  name: string;
  size: number;
  radius?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="thumb" style={{ width: size, height: size, ...(radius ? { borderRadius: radius } : {}) }}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage URLs, sized by CSS like the prototype
        <img alt="" src={src} onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function Kpi({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  tone: string;
  label: ReactNode;
  value: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kh">
        <span className={`ih ${tone}`}>{icon}</span>
        {label}
      </div>
      <div className="kv">{value}</div>
      <div className="ks">{sub}</div>
    </div>
  );
}
