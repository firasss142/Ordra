"use client";

// Shared pieces of Accueil: the page context (view + state + words + formats)
// and the prototype's small atoms — icon, arrows, store colours, « il y a ».

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { makeFmt, type Fmt, type Loc } from "@/components/performance/orders/ui";
import type { DashState } from "@/lib/dashboard/stores/period";
import type { Hue } from "@/lib/dashboard/stores/model";
import type { StoreDashView } from "@/lib/dashboard/stores/view";
import { ICON_PATHS } from "./icons";

export { makeFmt, type Fmt, type Loc };
export const NB = " ";
export const glue = (s: string) => s.replace(/« /g, `«${NB}`).replace(/ »/g, `${NB}»`);

/** The store's identity colour (two steps for the gradients); the colour is the store's, never its rank. */
export const HUES: Record<Hue, [string, string]> = {
  indigo: ["#444CE7", "#3538CD"],
  pink: ["#DD2590", "#C11574"],
  cyan: ["#088AB2", "#0E7090"],
  gold: ["#A15C07", "#854A0E"],
  lime: ["#4CA30D", "#3B7C0F"],
  slate: ["#667085", "#475467"],
};
export const hueVars = (h: Hue): CSSProperties => ({ "--a5": HUES[h][0], "--a7": HUES[h][1] }) as CSSProperties;

/** Platform glyphs on the small dark tile (prototype `PF.g`). */
export const PLATFORM_GLYPH: Record<string, string> = {
  converty: "C", shopify: "S", lightfunnels: "LF", youcan: "Y", woocommerce: "W", easyorders: "E", buybox: "B", sheets: "G", other: "·",
};

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

export type T = ReturnType<typeof useTranslations>;

export interface HomeCtx {
  view: StoreDashView;
  state: DashState;
  setState: (s: DashState) => void;
  t: T;
  f: Fmt;
  locale: string;
  tz: string;
  marketName: string;
  userName: string;
  owner: boolean;
  isToday: boolean;
  /** « hh:mm » of a market-local minute. */
  hm: (min: number) => string;
  /** Market-local « hh:mm » and day of an instant. */
  timeOf: (iso: string) => string;
  dayOf: (iso: string) => string;
  ago: (iso: string | null) => string;
  /** « les 30 jours d'avant » / « août » / « hier à la même heure » */
  prevName: string;
  /** The tooltip head of every arrow. */
  sameAge: string;
  href: (path: string) => string;
}

const Ctx = createContext<HomeCtx | null>(null);
export const HomeProvider = ({ value, children }: { value: HomeCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useHome(): HomeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHome outside HomeProvider");
  return c;
}

export function Ic({ n, className = "" }: { n: string; className?: string }) {
  return <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] ?? "" }} />;
}

function naTip(c: HomeCtx): string {
  return c.view.why === "before_first" ? c.t("trend.naBefore", { first: c.f.day(c.view.first) }) : c.t("trend.naFew");
}

/** An arrow in points per 100 (prototype `trendPts`). */
export function TrendPts({ now, prev, upGood, ok }: { now: number; prev: number | null; upGood: boolean; ok: boolean }) {
  const c = useHome();
  if (!ok || prev == null) return <span className="tr na" data-tip={naTip(c)}>—</span>;
  const d = Math.round(now) - Math.round(prev);
  if (!d) return <span className="tr eq" data-tip={c.t("trend.stable", { prev: c.sameAge, v: c.f.n(Math.round(prev)) })}>=</span>;
  return (
    <span className={`tr ${d > 0 === upGood ? "good" : "bad"}`} data-tip={c.t("trend.pts", { prev: c.sameAge, v: c.f.n(Math.round(prev)) })}>
      <Ic n={d > 0 ? "up" : "dn"} />
      {c.f.n(Math.abs(d))}
    </span>
  );
}

/** An arrow in % of change (prototype `trendPct`). */
export function TrendPct({ now, prev, ok, fmt }: { now: number; prev: number | null; ok: boolean; fmt: (v: number) => string }) {
  const c = useHome();
  if (!ok || !prev) return <span className="tr na" data-tip={!prev && ok ? c.t("trend.naEmpty") : naTip(c)}>—</span>;
  const d = Math.round(((now - prev) / Math.abs(prev)) * 100);
  if (!d) return <span className="tr eq" data-tip={c.t("trend.stable", { prev: c.sameAge, v: fmt(prev) })}>=</span>;
  return (
    <span className={`tr ${d > 0 ? "good" : "bad"}`} data-tip={c.t("trend.val", { prev: c.sameAge, v: fmt(prev) })}>
      <Ic n={d > 0 ? "up" : "dn"} />
      {c.f.pct(Math.abs(d))}
    </span>
  );
}

/** « 27 495 د.ل » with the symbol in its own smaller span. */
export function MoneyVal({ v, small }: { v: number; small?: boolean }) {
  const { f } = useHome();
  const r = Math.round(v);
  const txt = r >= 100_000 && small ? `${f.n(r / 1000)}${NB}k` : f.n(Math.abs(r));
  return (
    <>
      {r < 0 ? "−" : ""}
      {txt}
      <span className="ccy">
        {NB}
        {f.sym}
      </span>
    </>
  );
}

export const moneyText = (f: Fmt, v: number) => `${v < 0 ? "−" : ""}${f.n(Math.abs(Math.round(v)))} ${f.sym}`;
