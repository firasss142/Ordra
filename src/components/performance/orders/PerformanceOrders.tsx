"use client";

// Performance › Commandes (prototypes/performance-commandes-v4.html).
//
// The page's state lives in its URL (lib/performance/orders/query.ts); every
// figure comes computed from GET /api/performance/orders — nothing is counted,
// and no price is summed, in the browser. SWR keeps the previous figures on
// screen while a new filter loads.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import { parseState, stateToParams, type PerfState } from "@/lib/performance/orders/query";
import type { ProductSel } from "@/lib/performance/orders/facts";
import type { PerfView } from "@/lib/performance/orders/view";
import { DateButton, type DpState } from "./Dates";
import { FilterBar, type Pop } from "./FilterBar";
import { Hero, Money, Watch } from "./Top";
import { Flow, Leaks } from "./Flow";
import { ByAgent, ByProduct, Days, Defs } from "./Blocks";
import { Drawer, type DrillState } from "./Drawer";
import { Ic, PerfProvider, glue, makeFmt, type Loc, type PerfCtx } from "./ui";
import "./performance-orders.css";

const SUB_KEYS = new Set([
  "refus_client", "commande_invalide", "injoignable", "livraison_impossible", "autre",
  "deleted", "cancelled", "other", "customer", "noresp", "notneeded", "unknown",
]);

export function PerformanceOrders({ marketId, marketName, locale, tz }: { marketId: string; marketName: string; locale: string; tz: string }) {
  const t = useTranslations("performanceOrders");
  const sp = useSearchParams();
  const [state, setLocalState] = useState<PerfState>(() => parseState(new URLSearchParams(sp.toString())));
  const [dp, setDp] = useState<DpState | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const loc: Loc = locale === "ar" ? "ar" : "fr";

  const setState = useCallback((next: PerfState) => {
    setLocalState(next);
    const q = stateToParams(next).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, []);

  const query = useMemo(() => {
    const q = stateToParams(state);
    q.set("market_id", marketId);
    return q.toString();
  }, [state, marketId]);
  const { data: view, error, isValidating } = useSWR<PerfView>(`/api/performance/orders?${query}`, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  // ── tooltips + waffle highlight (the prototype's single mouseover handler) ──
  const tipRef = useRef<HTMLDivElement>(null);
  const onOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const ov = document.getElementById("ov");
    const k = target.closest?.("#ov [data-k]") as HTMLElement | null;
    if (ov) {
      if (k?.dataset.k) ov.dataset.hl = k.dataset.k;
      else delete ov.dataset.hl;
    }
    const tip = tipRef.current;
    if (!tip) return;
    const el = target.closest?.("[data-tip]") as HTMLElement | null;
    if (!el?.dataset.tip) {
      tip.classList.remove("on");
      return;
    }
    tip.textContent = glue(el.dataset.tip);
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

  // Escape closes the pickers or the date popover first, then the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pop || dp) {
        setPop(null);
        setDp(null);
      } else if (drill) setDrill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pop, dp, drill]);

  // A click outside an open picker or popover closes it.
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (dp && !target.closest(".dp, .dbtn, .dchip, .cmpseg")) setDp(null);
    if (pop && !target.closest(".picker, .addb, .cmpseg")) setPop(null);
  };

  const ctx: PerfCtx | null = useMemo(() => {
    if (!view) return null;
    const f = makeFmt(loc, view.currency);
    const products = new Map(view.products.map((p) => [p.id, p]));
    const agents = new Map(view.agents.map((a) => [a.id, a]));
    const product = (id: string) => products.get(id);
    const agent = (id: string | null) => (id ? agents.get(id) : undefined);
    const agentName = (id: string | null) => agent(id)?.name ?? t("byAgent.unknown");
    const selName = (sel: ProductSel) => {
      const ks = Object.keys(sel);
      if (!ks.length) return t("filter.allProducts");
      const one = (id: string) => {
        const p = product(id);
        const s = sel[id];
        return s ? `${p?.name ?? "?"} (${s.map((v) => p?.sizes.find((z) => z.id === v)?.label ?? "?").join(", ")})` : p?.name ?? "?";
      };
      return ks.length <= 2 ? ks.map(one).join(" + ") : t("filter.nProducts", { n: ks.length });
    };
    const agName = (ag: string[]) => (!ag.length ? t("filter.allTeam") : ag.length <= 2 ? ag.map(agentName).join(" + ") : t("filter.nAgents", { n: ag.length }));
    const fullName = (sel: ProductSel, ag: string[]) => {
      const p = Object.keys(sel).length ? selName(sel) : "";
      const a = ag.length ? agName(ag) : "";
      return p && a ? `${p} · ${a}` : p || a || t("filter.allOrders");
    };
    const w = view.window;
    const prevName =
      w.prev.kind === "days"
        ? t("period.nameDays", { n: w.prev.len })
        : w.prev.kind === "month"
          ? t("period.nameMonth", { month: f.month(w.prev.month) })
          : t("period.nameMonthStart", { month: f.month(w.prev.month) });
    const subLabel = (key: string | null, short = false) => {
      if (!key) return t("sub.unknown");
      const c = view.subLabels[key];
      if (c) return loc === "ar" ? (short && c.short_ar) || c.ar : (short && c.short_fr) || c.fr;
      if (SUB_KEYS.has(key)) return t(short ? `subShort.${key}` : `sub.${key}`);
      return key;
    };
    const c = state.cmp;
    const bLabel =
      c?.kind === "p" ? fullName(c.sel, state.ag) : c?.kind === "a" ? agName(c.ag) : c?.kind === "d" ? f.range(c.from, c.to) : "";
    const bSub =
      c?.kind === "p" ? t("filter.sameDates") : c?.kind === "a" ? `${selName(state.sel)} · ${t("filter.sameDates")}` : c?.kind === "d" ? fullName(state.sel, state.ag) : "";
    return {
      view,
      state,
      t,
      f,
      product,
      agent,
      agentName,
      selName,
      agName,
      fullName,
      prevName,
      subLabel,
      bLabel,
      bSub,
      setState,
      openDrill: (key: string) => setDrill({ key, dsel: null, limit: 40 }),
    };
  }, [view, state, loc, t, setState]);

  if (!ctx) {
    return (
      <div className="pco">
        <div className="page">
          {error ? (
            <div className="err">{t("head.error")}</div>
          ) : (
            <>
              <div className="sk" style={{ height: 70, background: "transparent", border: 0, boxShadow: "none" }} aria-busy="true">
                <span className="meta">{t("head.loading")}</span>
              </div>
              <div className="sk" style={{ height: 320 }} />
              <div className="sk" style={{ height: 220 }} />
            </>
          )}
        </div>
      </div>
    );
  }

  const { view: v, f } = ctx;
  const hasSel = Object.keys(state.sel).length > 0 || state.ag.length > 0;
  const ok = v.A.final >= 90;

  return (
    <PerfProvider value={ctx}>
      <div className="pco" onMouseOver={onOver} onMouseMove={onMove} onClick={onClick}>
        <div className={`page${isValidating ? " loading" : ""}`}>
          <header className="ph">
            <div>
              <div className="crumb">
                {t("head.crumb")} <Ic n="right" /> {t("head.crumbPage")}
              </div>
              <h1>{t("head.title")}</h1>
              <div className="sub">
                <span>
                  {marketName} ·{" "}
                  {v.store && (
                    <>
                      <b data-tip={t("head.storeTip")}>{v.store.name}</b>{" "}
                      <button type="button" className="chipb" onClick={() => setState({ ...state, store: null })}>
                        {t("head.storeClear")}
                      </button>{" "}
                      ·{" "}
                    </>
                  )}
                  {hasSel && (
                    <>
                      <b>{ctx.fullName(state.sel, state.ag)}</b> ·{" "}
                    </>
                  )}
                  {t.rich("head.received", { n: v.A.n, nf: f.n(v.A.n), b: (c) => <b>{c}</b> })}
                </span>
                <span className={`pill${ok ? "" : " warn"}`} data-tip={t("head.finalTip")}>
                  <Ic n={ok ? "check" : "clock"} />
                  {t("head.final", { pct: f.pct(v.A.final) })}
                </span>
              </div>
            </div>
            <DateButton dp={dp} setDp={setDp} />
          </header>
          {error && <div className="err">{t("head.error")}</div>}
          <FilterBar pop={pop} setPop={setPop} dp={dp} setDp={setDp} />
          <Hero />
          <Money />
          <Watch locale={locale} />
          <Flow />
          <Leaks />
          <div className="duo">
            <ByProduct />
            <ByAgent locale={locale} />
          </div>
          <Days />
          <Defs />
        </div>
        <Drawer drill={drill} setDrill={setDrill} query={query} locale={locale} tz={tz} />
        <div className="tip" ref={tipRef} />
      </div>
    </PerfProvider>
  );
}
