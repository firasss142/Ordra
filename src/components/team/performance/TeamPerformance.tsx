"use client";

// Performance › Équipe (prototypes/team-performance-v3.html, plans/team-performance-redesign.md).
//
// One question: why do agents lose orders? Every figure comes computed from
// GET /api/team/performance; the browser only keeps the page's state in its
// URL (?period=30d|7d|month|custom &from &to &agent=<id> &view=table &day=…)
// and chooses what to highlight. SWR keeps the previous figures on screen while
// a new window loads.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import { daysBetween, hm } from "@/lib/team/room/time";
import { PERIODS, parsePeriodKind, type PeriodKind } from "@/lib/team/performance/period";
import type { AgentInfo, TeamPerfView } from "@/lib/team/performance/build";
import { glue, makeFmt, type Loc } from "@/components/performance/orders/ui";
import { Overview } from "./Overview";
import { Classement } from "./Classement";
import { DebitMap } from "./DebitMap";
import { Products } from "./Products";
import { Presence } from "./Presence";
import { Av, Ic, TpProvider, type TpCtx } from "./ui";
import "./team-performance.css";

interface UrlState {
  period: PeriodKind;
  from: string | null;
  to: string | null;
  agent: string | null;
  view: "map" | "table";
  day: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function readState(sp: URLSearchParams): UrlState {
  const day = sp.get("day");
  return {
    period: parsePeriodKind(sp.get("period")),
    from: sp.get("from"),
    to: sp.get("to"),
    agent: sp.get("agent"),
    view: sp.get("view") === "table" ? "table" : "map",
    day: day && ISO_DAY.test(day) ? day : null,
  };
}

function writeState(s: UrlState): string {
  const q = new URLSearchParams();
  q.set("period", s.period);
  if (s.period === "custom" && s.from && s.to) {
    q.set("from", s.from);
    q.set("to", s.to);
  }
  if (s.agent) q.set("agent", s.agent);
  if (s.view !== "map") q.set("view", s.view);
  if (s.day) q.set("day", s.day);
  return q.toString();
}

const UNKNOWN = (id: string): AgentInfo => ({ id, name: "—", color: "indigo", avatarUrl: null });

export function TeamPerformance({ marketId, marketName, locale, tz }: { marketId: string; marketName: string; locale: string; tz: string }) {
  const t = useTranslations("teamPerformance");
  const sp = useSearchParams();
  const [s, setLocal] = useState<UrlState>(() => readState(new URLSearchParams(sp.toString())));
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const loc: Loc = locale === "ar" ? "ar" : "fr";

  const setState = useCallback((next: UrlState) => {
    setLocal(next);
    window.history.replaceState(null, "", `${window.location.pathname}?${writeState(next)}`);
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams({ market_id: marketId, period: s.period });
    if (s.period === "custom" && s.from && s.to) {
      q.set("from", s.from);
      q.set("to", s.to);
    }
    return q.toString();
  }, [marketId, s.period, s.from, s.to]);
  const { data: view, error, isValidating } = useSWR<TeamPerfView>(`/api/team/performance?${query}`, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const setFocus = useCallback((id: string) => {
    const y = window.scrollY;
    setLocal((cur) => {
      const next = { ...cur, agent: cur.agent === id ? null : id };
      window.history.replaceState(null, "", `${window.location.pathname}?${writeState(next)}`);
      return next;
    });
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, []);

  // Escape closes the custom popover first, then lets go of the agent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (custom) setCustom(null);
      else if (s.agent) setFocus(s.agent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [custom, s.agent, setFocus]);

  // ── tooltips + waffle highlight (the prototype's single mouseover handler) ──
  const tipRef = useRef<HTMLDivElement>(null);
  const onOver = (e: MouseEvent) => {
    const target = e.target as Element;
    const ov = document.getElementById("ov");
    const k = target.closest?.("#ov [data-k]") as HTMLElement | null;
    if (ov) {
      if (k?.dataset.k) ov.dataset.hl = k.dataset.k;
      else delete ov.dataset.hl;
    }
    const tip = tipRef.current;
    if (!tip) return;
    const el = target.closest?.("[data-tip]") as HTMLElement | SVGElement | null;
    const text = el?.getAttribute("data-tip");
    if (!text) {
      tip.classList.remove("on");
      return;
    }
    tip.textContent = glue(text);
    tip.classList.add("on");
  };
  const onMove = (e: MouseEvent) => {
    const tip = tipRef.current;
    if (!tip || !tip.classList.contains("on")) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  // A bubble on the map focuses its agent (SVG groups carry data-focus).
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element;
    if (custom && !target.closest(".cpop, [data-period=custom]")) setCustom(null);
    const g = target.closest?.("#map [data-focus]");
    const id = g?.getAttribute("data-focus");
    if (id) setFocus(id);
  };

  const ctx: TpCtx | null = useMemo(() => {
    if (!view?.window) return null;
    const f = makeFmt(loc, "LYD");
    const agents = new Map(view.agents.map((a) => [a.id, a]));
    const w = view.window;
    const n = daysBetween(w.from, w.to) + 1;
    const dur = (min: number) => {
      const m0 = Math.round(min), h = Math.floor(m0 / 60), m = m0 % 60;
      if (!h) return t("dur.m", { m: f.n(m) });
      return m ? t("dur.hm", { h: f.n(h), m: String(m).padStart(2, "0") }) : t("dur.h", { h: f.n(h) });
    };
    return {
      view,
      t,
      f,
      locale,
      focus: s.agent,
      setFocus,
      agent: (id: string) => agents.get(id) ?? UNKNOWN(id),
      prevName: t(`prev.${w.kind}`, { n }),
      shortName: t(`short.${w.kind}`, { n }),
      perName: t(`per.${w.kind}`),
      dur,
      hm,
      dimIf: (id: string) => (s.agent && s.agent !== id ? " dim" : ""),
    };
  }, [view, loc, t, locale, s.agent, setFocus]);

  const city = (tz.split("/")[1] ?? tz).replace(/_/g, " ");

  const periodBtn = (p: PeriodKind) => (
    <button
      key={p}
      className={s.period === p ? "on" : ""}
      data-period={p}
      onClick={() => {
        if (p === "custom") {
          const w = view?.window;
          setCustom(custom ? null : { from: s.from ?? w?.from ?? "", to: s.to ?? w?.to ?? "" });
          return;
        }
        setCustom(null);
        setState({ ...s, period: p, from: null, to: null, day: null });
      }}
    >
      {p === "custom" && <Ic n="cal" />}
      {t(`per.${p}`)}
    </button>
  );

  if (!ctx) {
    return (
      <div className="tpf">
        <div className="page">
          {error ? (
            <div className="err">{t("head.error")}</div>
          ) : (
            <>
              <div className="sk" style={{ height: 70, background: "transparent", border: 0, boxShadow: "none" }} aria-busy="true">
                <span className="meta">{t("head.loading")}</span>
              </div>
              <div className="sk" style={{ height: 300 }} />
              <div className="sk" style={{ height: 520 }} />
            </>
          )}
        </div>
      </div>
    );
  }

  const v = ctx.view, f = ctx.f, w = v.window;
  return (
    <TpProvider value={ctx}>
      <div className="tpf" onMouseOver={onOver} onMouseMove={onMove} onClick={onClick}>
        <div className={`page${isValidating ? " loading" : ""}`}>
          <header className="ph">
            <div>
              <div className="crumb">
                {t("head.crumb")}
                <i>/</i>
                {t("head.crumbPage")}
              </div>
              <h1>{t("head.title")}</h1>
              <div className="sub">
                <span className="stack">
                  {v.agents.map((a) => (
                    <span key={a.id} onClick={() => setFocus(a.id)}>
                      <Av a={a} />
                    </span>
                  ))}
                </span>
                <span>{t("head.sub", { market: marketName, n: f.n(v.team.a), from: f.day(w.from), to: f.day(w.to) })}</span>
              </div>
            </div>
            <div className="seg" role="tablist">
              {PERIODS.map(periodBtn)}
              {custom && (
                <div className="cpop">
                  <label>
                    {t("custom.from")}
                    <input type="date" value={custom.from} max={w.today} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
                  </label>
                  <label>
                    {t("custom.to")}
                    <input type="date" value={custom.to} max={w.today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
                  </label>
                  <button
                    className="go"
                    disabled={!ISO_DAY.test(custom.from) || !ISO_DAY.test(custom.to) || custom.from > custom.to}
                    onClick={() => {
                      setState({ ...s, period: "custom", from: custom.from, to: custom.to, day: null });
                      setCustom(null);
                    }}
                  >
                    {t("custom.apply")}
                  </button>
                </div>
              )}
            </div>
          </header>
          {error && <div className="err">{t("head.error")}</div>}
          <Overview />
          <Classement />
          <div className="duo">
            <DebitMap mode={s.view} setMode={(m) => setState({ ...s, view: m })} />
            <Products />
          </div>
          <Presence day={s.day} setDay={(d) => setState({ ...s, day: d })} city={city} />
        </div>
        <div className="tip" ref={tipRef} />
      </div>
    </TpProvider>
  );
}
