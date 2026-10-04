"use client";

// Shared pieces of Performance › Commandes: the page context (view + state +
// words + formats) and the prototype's small atoms — icon, arrow, B chip,
// product thumb, agent avatar, outcome bar.

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { agentColorKey, agentColorVars } from "@/lib/team/agent-color";
import { currencySymbol, dayLabel, groupDigits, numText } from "@/lib/products/format";
import { OUTCOMES, type Outcome, type ProductSel } from "@/lib/performance/orders/facts";
import { round100, type Summary } from "@/lib/performance/orders/model";
import type { PerfState } from "@/lib/performance/orders/query";
import type { AgentInfo, CatalogueProduct, PerfView } from "@/lib/performance/orders/view";
import { ICON_PATHS } from "./icons";

export type Loc = "fr" | "ar";
export const NB = " ";

/** « texte » with no-break spaces inside the guillemets, as the prototype prints them. */
export const glue = (s: string) => s.replace(/« /g, `«${NB}`).replace(/ »/g, `${NB}»`);

export interface Fmt {
  loc: Loc;
  /** A whole (or `d`-decimal) number, bidi-safe. */
  n: (v: number, d?: number) => string;
  /** A value already in % (55.2 → « 55 % »). */
  pct: (v: number, d?: number) => string;
  /** « 27 495 د.ل » */
  money: (v: number) => string;
  sym: string;
  day: (d: string) => string;
  dayLong: (d: string) => string;
  range: (f: string, t: string) => string;
  month: (m: string, cap?: boolean) => string;
}

const intl = new Map<string, Intl.DateTimeFormat>();
function dtf(loc: Loc, opts: Intl.DateTimeFormatOptions) {
  const k = `${loc}|${JSON.stringify(opts)}`;
  let f = intl.get(k);
  if (!f) intl.set(k, (f = new Intl.DateTimeFormat(loc === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { ...opts, timeZone: "UTC" })));
  return f;
}

export function makeFmt(loc: Loc, currency: string): Fmt {
  const n = (v: number, d = 0) => (loc === "ar" ? numText(v, d) : `${v < 0 && Number(v.toFixed(d)) < 0 ? "−" : ""}${groupDigits(v, d)}`);
  const sym = currencySymbol(currency);
  const day = (d: string) => dayLabel(d, loc);
  const month = (m: string, cap = false) => {
    const s = dtf(loc, { month: "long" }).format(new Date(`${m}-15T12:00:00Z`));
    return cap && loc === "fr" ? s[0].toUpperCase() + s.slice(1) : s;
  };
  return {
    loc,
    n,
    pct: (v, d = 0) => `${n(v, d)}${loc === "ar" ? "%" : `${NB}%`}`,
    money: (v) => `${n(Math.round(v))}${NB}${sym}`,
    sym,
    day,
    dayLong: (d) => dtf(loc, { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00Z`)),
    range: (f, t) => (f === t ? day(f) : `${day(f)} → ${day(t)}`),
    month,
  };
}

export type T = ReturnType<typeof useTranslations>;

export interface PerfCtx {
  view: PerfView;
  state: PerfState;
  t: T;
  f: Fmt;
  product: (id: string) => CatalogueProduct | undefined;
  agent: (id: string | null) => AgentInfo | undefined;
  agentName: (id: string | null) => string;
  selName: (sel: ProductSel) => string;
  agName: (ag: string[]) => string;
  fullName: (sel: ProductSel, ag: string[]) => string;
  /** « les 30 jours d'avant » / « août » / « le même début de septembre » */
  prevName: string;
  subLabel: (key: string | null, short?: boolean) => string;
  bLabel: string;
  bSub: string;
  setState: (next: PerfState) => void;
  openDrill: (key: string) => void;
}

const Ctx = createContext<PerfCtx | null>(null);
export const PerfProvider = ({ value, children }: { value: PerfCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function usePerf(): PerfCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePerf outside PerfProvider");
  return c;
}

// ── atoms ───────────────────────────────────────────────────────────────────

export function Ic({ n, className = "" }: { n: string; className?: string }) {
  return <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] ?? "" }} />;
}

/** The arrow against the previous period (prototype `trend`). */
export function Trend({ now, prev, upGood, why }: { now: number | null; prev: number | null; upGood: boolean; why?: string }) {
  const { view, t, f, prevName } = usePerf();
  const c = view.comparable;
  if (!c.ok) {
    const r =
      c.why === "before_first"
        ? t("trend.naBefore", { first: f.day(view.first) })
        : c.why === "not_final"
          ? t("trend.naFinal", { pct: f.n(c.final) })
          : t("trend.naFew");
    return <span className="tr na" data-tip={why ?? r}>—</span>;
  }
  if (now == null || prev == null) return null;
  const d = Math.round(now) - Math.round(prev);
  if (!d) return <span className="tr eq" data-tip={t("trend.stable", { prev: prevName, v: f.n(Math.round(prev)) })}>=</span>;
  return (
    <span className={`tr ${d > 0 === upGood ? "good" : "bad"}`} data-tip={t("trend.prev", { prev: prevName, v: f.n(Math.round(prev)) })}>
      <Ic n={d > 0 ? "up" : "dn"} />
      {f.n(Math.abs(d))}
    </span>
  );
}

/** B's value next to A's (prototype `BV`). */
export function Vs({ v, fmt }: { v: (s: Summary) => number | null; fmt?: (x: number | null) => string }) {
  const { view, bLabel, bSub, f } = usePerf();
  if (!view.B || view.B.empty) return null;
  const x = v(view.B.s);
  return (
    <span className="vs" data-tip={`B · ${bLabel} · ${bSub}`}>
      <i />B {fmt ? fmt(x) : x == null ? "—" : f.n(Math.round(x))}
    </span>
  );
}

const THUMB = [
  ["#6172F3", "#3538CD"],
  ["#EE46BC", "#C11574"],
  ["#22CCEE", "#0E7090"],
  ["#FDB022", "#B54708"],
  ["#66C61C", "#3B7C0F"],
  ["#FF692E", "#C4320A"],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function Thumb({ id }: { id: string }) {
  const { product } = usePerf();
  const p = product(id);
  const [c1, c2] = THUMB[hash(id) % THUMB.length];
  const name = p?.name ?? "?";
  return (
    <span className="thumb" style={{ "--c1": c1, "--c2": c2 } as CSSProperties}>
      {p?.image ? <img src={p.image} alt="" /> : name.trim()[0]?.toUpperCase()}
    </span>
  );
}

export function Av({ id }: { id: string | null }) {
  const { agent } = usePerf();
  const a = agent(id);
  const key = agentColorKey(a?.color ?? null, id ?? "none");
  const vars = agentColorVars(key) as Record<string, string>;
  return (
    <span className="av" style={vars as CSSProperties}>
      {a?.avatar ? <img src={a.avatar} alt="" /> : (a?.name ?? "?").trim()[0]}
    </span>
  );
}

export const TagAB = ({ w }: { w: "A" | "B" }) => (
  <span className="rowtag" style={{ "--c": `var(--c${w})` } as CSSProperties}>
    {w}
  </span>
);

export const SW = ({ k }: { k: string }) => <span className={`sw k-${k}`} />;

/** The outcome bar of a row (prototype `sbar`). */
export function Sbar({ s }: { s: Summary }) {
  const { t, f } = usePerf();
  const rr = round100(s.p);
  return (
    <span className="sbar">
      {OUTCOMES.map((k) =>
        rr[k] ? (
          <i key={k} className={`k-${k}`} style={{ flex: rr[k] }} data-tip={t("byProduct.sbarTip", { o: t(`o1.${k}`), n: rr[k], nf: f.n(s[k]) })}>
            {rr[k] >= 7 ? rr[k] : ""}
          </i>
        ) : null,
      )}
    </span>
  );
}

export function ThinB({ s }: { s: Summary | null }) {
  const { t, f, bLabel } = usePerf();
  if (!s) return null;
  const br = round100(s.p);
  return (
    <span className="sbar b" data-tip={t("byProduct.thinTip", { label: bLabel, del: Math.round(s.p.del), nf: f.n(s.n) })}>
      {OUTCOMES.map((k: Outcome) => (br[k] ? <i key={k} className={`k-${k}`} style={{ flex: br[k] }} /> : null))}
    </span>
  );
}

/** « 27 495 د.ل » with the symbol in its own smaller span (money tiles). */
export function MoneyVal({ v }: { v: number }) {
  const { f } = usePerf();
  return (
    <>
      {f.n(Math.round(v))}
      {NB}
      <span className="ccy">{f.sym}</span>
    </>
  );
}
