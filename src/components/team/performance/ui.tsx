"use client";

// Shared pieces of Performance › Équipe (prototypes/team-performance-v3.html):
// the page context (view + focus + words + formats) and the prototype's atoms —
// icon, avatar, arrow, the leak's look, the line to tell her.

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { agentColorVars } from "@/lib/team/agent-color";
import { JUNK_SUBS, type Leak } from "@/lib/team/performance/model";
import type { AgentInfo, TeamPerfView } from "@/lib/team/performance/build";
import type { Fmt } from "@/components/performance/orders/ui";
import { ICON_PATHS } from "./icons";

export type T = ReturnType<typeof useTranslations>;

export interface TpCtx {
  view: TeamPerfView;
  t: T;
  f: Fmt;
  locale: string;
  focus: string | null;
  setFocus: (id: string) => void;
  agent: (id: string) => AgentInfo;
  /** « les 30 jours d'avant » */
  prevName: string;
  /** « 30 j » */
  shortName: string;
  /** « 30 jours » */
  perName: string;
  /** « 5 h 46 », « 45 min » */
  dur: (min: number) => string;
  /** 845 → « 14:05 » */
  hm: (min: number) => string;
  /** Agent name, or the class « dim » when another agent has the focus. */
  dimIf: (id: string) => string;
}

const Ctx = createContext<TpCtx | null>(null);
export const TpProvider = ({ value, children }: { value: TpCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useTp(): TpCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTp outside TpProvider");
  return c;
}

export function Ic({ n, className = "" }: { n: string; className?: string }) {
  return <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[n] ?? "" }} />;
}

/** Her ramp as --a0…--a9 for everything inside the element. */
export const agv = (a: AgentInfo): CSSProperties => agentColorVars(a.color);

export function Av({ a, className = "" }: { a: AgentInfo; className?: string }) {
  return (
    <span className={`av ${className}`} style={agv(a)} data-tip={a.name}>
      {a.name.charAt(0)}
    </span>
  );
}

/** The arrow against the previous window (prototype `trend`). */
export function Trend({ now, prev, upGood, hide }: { now: number | null; prev: number | null; upGood: boolean; hide?: boolean }) {
  const { t, f, prevName } = useTp();
  if (hide) return <span className="tr na" data-tip={t("trend.na")}>—</span>;
  if (prev == null || now == null) return null;
  const d = Math.round(now) - Math.round(prev);
  const tip = t("trend.prev", { prev: prevName, v: f.n(Math.round(prev)) });
  if (d === 0) return <span className="tr eq" data-tip={`${t("trend.stable")} · ${tip}`}>=</span>;
  const good = d > 0 === upGood;
  return (
    <span className={`tr ${good ? "good" : "bad"}`} data-tip={`${t(d > 0 ? "trend.up" : "trend.down")} · ${tip}`}>
      <Ic n={d > 0 ? "up" : "dn"} />
      {f.n(Math.abs(d))}
    </span>
  );
}

const SAY_KEYS = new Set([
  "autre", "non_serieux", "non_commande", "simple_info", "doublon", "changement_avis", "prix_eleve", "produit_non_voulu",
  "achete_ailleurs", "pas_de_reponse", "numero_hors_service", "numero_invalide", "mauvais_interlocuteur", "raccroche",
  "hors_couverture", "ret", "first", "late",
]);
const GROUPS = new Set(["refus_client", "injoignable", "livraison_impossible", "commande_invalide", "autre"]);

/** A leak wears the colour of the outcome its orders ended in; a timing leak has no outcome, so it stays ink. */
export function useLeakView() {
  const { t, view, f } = useTp();
  return (lk: Leak): { label: string; icon: string; tone: string } => {
    if (lk.type === "autre") return { label: t("leak.autre"), icon: "g_autre", tone: "var(--o-rej)" };
    if (lk.type === "sub") {
      const r = view.reasons[lk.key];
      const name = r ? (f.loc === "ar" ? r.ar : r.fr) : lk.key;
      const g = r?.group && GROUPS.has(r.group) ? r.group : "autre";
      return { label: t("leak.sub", { label: name }), icon: `g_${g}`, tone: JUNK_SUBS.includes(lk.key) ? "var(--o-junk)" : "var(--o-rej)" };
    }
    if (lk.type === "ret") return { label: t("leak.ret"), icon: "ret", tone: "var(--o-ret)" };
    if (lk.type === "first") return { label: t("leak.first"), icon: "phone", tone: "var(--o-rej)" };
    return { label: t("leak.late"), icon: "clock", tone: "var(--ink-2)" };
  };
}

export function SayBox({ k }: { k: string }) {
  const { t } = useTp();
  return (
    <div className="say">
      <span className="say-ic">
        <Ic n="say" />
      </span>
      <div>
        <div className="eyebrow">{t("say.eyebrow")}</div>
        <p>{t(`say.${SAY_KEYS.has(k) ? k : "other"}`)}</p>
      </div>
    </div>
  );
}

export function CmpBars({ lk }: { lk: Leak }) {
  const { t, f } = useTp();
  return (
    <div className="cmp">
      <span>{t("cmp.her")}</span>
      <div className="bar">
        <i style={{ width: `${(lk.hr * 100).toFixed(1)}%` }} />
      </div>
      <b>{f.pct(lk.hr * 100)}</b>
      <span>{t("cmp.rest")}</span>
      <div className="bar rest">
        <i style={{ width: `${(lk.rr * 100).toFixed(1)}%` }} />
      </div>
      <b>{f.pct(lk.rr * 100)}</b>
      <span className="cmp-u">{t(`cmp.unit.${lk.unit}`)}</span>
    </div>
  );
}

/** The element's width, kept up to date (the map and the timelines draw to it). */
export function useWidth<E extends HTMLElement>(): [React.RefObject<E>, number] {
  const ref = useRef<E>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setW(el.clientWidth));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  return [ref, w];
}
