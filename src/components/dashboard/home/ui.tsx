"use client";

// Shared pieces of Accueil v9 (prototypes/dashboard-v9.html): the page context
// (view + state + words + formats) and the prototype's small atoms — icon, arrow,
// store colours, money with a small symbol.

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { makeFmt, type Fmt, type Loc } from "@/components/performance/orders/ui";
import type { DashState } from "@/lib/dashboard/stores/period";
import type { Hue } from "@/lib/dashboard/stores/model";
import type { StoreDashView } from "@/lib/dashboard/stores/view";
import { change } from "@/lib/dashboard/stores/trend";
import { ICON_PATHS } from "./icons";

export { makeFmt, type Fmt, type Loc };
export const NB = " ";
export const glue = (s: string) => s.replace(/« /g, `«${NB}`).replace(/ »/g, `${NB}»`);

/** The store's identity colour (two steps); the colour is the store's, never its rank. */
export const HUES: Record<Hue, [string, string]> = {
  indigo: ["#444CE7", "#3538CD"],
  pink: ["#DD2590", "#C11574"],
  cyan: ["#088AB2", "#0E7090"],
  gold: ["#A15C07", "#854A0E"],
  lime: ["#4CA30D", "#3B7C0F"],
  slate: ["#98A2B3", "#667085"],
};
export const hueVars = (h: Hue): CSSProperties => ({ "--a5": HUES[h][0], "--a7": HUES[h][1] }) as CSSProperties;

export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
}

/** A shop's mark: its uploaded logo, else its initials on its colour. */
export function StoreLogo({ name, logo, className = "av" }: { name: string; logo: string | null; className?: string }) {
  return (
    <span className={`${className}${logo ? " img" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded logos live on any host */}
      {logo ? <img src={logo} alt="" /> : initials(name)}
    </span>
  );
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
  /** « Aujourd'hui » or « Hier ». */
  day: boolean;
  /** The content area is phone-wide (≤ 640 px): rows and bottom sheets. */
  phone: boolean;
  /** « hh:mm » of a market-local minute. */
  hm: (min: number) => string;
  /** Market-local « hh:mm » and day of an instant. */
  timeOf: (iso: string) => string;
  dayOf: (iso: string) => string;
  ago: (iso: string | null) => string;
  /** « aujourd'hui à 09:41 » / « hier à 18:40 » / « le 2 oct. » */
  when: (iso: string) => string;
  /** « les 7 jours d'avant » / « en août » */
  prevName: string;
  /** The window as a button label: « Aujourd'hui », « 30 derniers jours », « Septembre 2026 »… */
  periodLabel: string;
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

/**
 * An arrow in % of change (prototype `trendPct`). Under ±5 % it stays grey: noise, not news.
 * From +200 % it reads « ×3 ».
 */
export function TrendPct({ now, prev, tip, fmt }: { now: number; prev: number | null; tip?: boolean; fmt: (v: number) => string }) {
  const c = useHome();
  if (!prev) return null;
  const ch = change(now, prev);
  const dt = tip === false ? undefined : c.t("kpi.tip", { label: c.prevName, v: fmt(prev) });
  if (!ch.dir) return <span className="tr eq" data-tip={dt}>=</span>;
  const cls = ch.pct < 5 ? "eq" : ch.dir > 0 ? "good" : "bad";
  return (
    <span className={`tr ${cls}`} data-tip={dt}>
      <Ic n={ch.dir > 0 ? "up" : "dn"} />
      {ch.times ? `×${c.f.n(ch.times)}` : c.f.pct(ch.pct)}
    </span>
  );
}

/** « 27 495 DT » with the symbol in its own smaller span (prototype `MH`). */
export function MoneyVal({ v }: { v: number }) {
  const { f } = useHome();
  const r = Math.round(v);
  return (
    <>
      {r < 0 ? "−" : ""}
      {f.n(Math.abs(r))}
      <span className="ccy">{f.sym}</span>
    </>
  );
}

export const moneyText = (f: Fmt, v: number) => `${v < 0 ? "−" : ""}${f.n(Math.abs(Math.round(v)))}${NB}${f.sym}`;
