"use client";

// Accueil v9 « le point du jour » (prototypes/dashboard-v9.html, plans/accueil-v3-point-du-jour.md).
//
// The page's state lives in its URL (?period=…&from=&to=&view=list); every figure comes
// computed from GET /api/dashboard/stores — nothing is counted, and no price is summed, in
// the browser. SWR keeps the previous figures on screen while another period loads, refreshes
// every minute on « Aujourd'hui » (5 min otherwise) and when the tab comes back.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import { isDayWindow, parseDashState, type DashState } from "@/lib/dashboard/stores/period";
import type { StoreDashView } from "@/lib/dashboard/stores/view";
import { DateSheetBody, windowLabel, type DpState } from "./Dates";
import { CardBody, Header, Hero, StoresBlock } from "./Blocks";
import { HomeProvider, Ic, glue, hueVars, makeFmt, type HomeCtx, type Loc } from "./ui";
import { HomeSkeleton } from "./HomeSkeleton";
import "./store-dashboard.css";

type ViewMode = "cards" | "list";

function stateToParams(s: DashState, mode: ViewMode): URLSearchParams {
  const q = new URLSearchParams();
  if (s.period !== "today") q.set("period", s.period);
  if (s.period === "custom" && s.from && s.to) {
    q.set("from", s.from);
    q.set("to", s.to);
  }
  if (mode === "list") q.set("view", "list");
  return q;
}

/** Figures older than this were not refreshed (offline, a failing request): say so. */
const STALE_MIN = 10;

export function StoreDashboard({
  marketId,
  marketName,
  userName,
  locale,
  tz,
}: {
  marketId: string;
  marketName: string;
  userName: string;
  locale: string;
  tz: string;
}) {
  const t = useTranslations("home");
  const router = useRouter();
  const sp = useSearchParams();
  const [state, setLocal] = useState<DashState>(() => parseDashState(new URLSearchParams(sp.toString())));
  const [mode, setModeLocal] = useState<ViewMode>(() => (sp.get("view") === "list" ? "list" : "cards"));
  const [dp, setDp] = useState<DpState | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const loc: Loc = locale === "ar" ? "ar" : "fr";

  const writeUrl = useCallback((s: DashState, m: ViewMode) => {
    const q = stateToParams(s, m).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, []);
  const setState = useCallback(
    (next: DashState) => {
      setLocal(next);
      writeUrl(next, mode);
    },
    [writeUrl, mode],
  );
  const setMode = (m: ViewMode) => {
    setModeLocal(m);
    writeUrl(state, m);
  };

  // The content area decides, not the window: ≤ 640 px = rows and bottom sheets.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPhone(el.clientWidth > 0 && el.clientWidth <= 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const query = useMemo(() => {
    const q = stateToParams(state, "cards");
    q.set("market_id", marketId);
    return q.toString();
  }, [state, marketId]);
  const { data: view, error, isLoading, mutate } = useSWR<StoreDashView>(`/api/dashboard/stores?${query}`, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
    refreshInterval: state.period === "today" ? 60_000 : 300_000,
  });

  // ── tooltips (hover on desktop, a tap on touch screens) ──
  const tipRef = useRef<HTMLDivElement>(null);
  const showTip = (el: HTMLElement | null, x: number, y: number) => {
    const tip = tipRef.current;
    if (!tip) return;
    if (!el?.dataset.tip) {
      tip.classList.remove("on");
      return;
    }
    tip.textContent = glue(el.dataset.tip);
    tip.classList.add("on");
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = x + 14;
    let top = y - h - 12;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top < 8) top = y + 18;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  };
  const onMove = (e: MouseEvent) => showTip((e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null, e.clientX, e.clientY);
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    showTip((e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null, e.clientX, e.clientY);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDp(null);
        setSheet(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (dp && !phone && !target.closest(".dp, .dbtn")) setDp(null);
  };

  const ctx: HomeCtx | null = useMemo(() => {
    if (!view) return null;
    const f = makeFmt(loc, view.currency);
    const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const timeOf = (iso: string) => timeFmt.format(new Date(iso));
    const dayOf = (iso: string) => dayFmt.format(new Date(iso));
    const nowMs = Date.parse(view.now);
    const daysAgo = (iso: string) => Math.round((Date.parse(view.today) - Date.parse(dayOf(iso))) / 86_400_000);
    const ago = (iso: string | null) => {
      if (!iso) return t("ago.never");
      const mins = Math.floor((nowMs - Date.parse(iso)) / 60_000);
      const days = daysAgo(iso);
      if (mins < 60) return t("ago.min", { n: f.n(Math.max(1, mins)) });
      if (days === 0) return t("ago.h", { n: f.n(Math.floor(mins / 60)) });
      if (days === 1) return t("ago.yesterday", { time: timeOf(iso) });
      if (days < 7) return t("ago.d", { n: f.n(days) });
      return t("ago.day", { day: f.day(dayOf(iso)) });
    };
    const when = (iso: string) => {
      const days = daysAgo(iso);
      if (days === 0) return t("ago.today", { time: timeOf(iso) });
      if (days === 1) return t("ago.yesterday", { time: timeOf(iso) });
      return t("ago.day", { day: f.day(dayOf(iso)) });
    };
    const w = view.window;
    const prevName =
      w.prev.kind === "days"
        ? t("period.nameDays", { n: f.n(w.prev.len) })
        : w.prev.kind === "month"
          ? t("period.nameMonth", { month: f.month(w.prev.month) })
          : w.prev.kind === "monthStart"
            ? t("period.nameMonthStart", { month: f.month(w.prev.month) })
            : t("period.yesterday");
    return {
      view,
      state,
      setState: (s: DashState) => {
        setDp(null);
        setState(s);
      },
      t,
      f,
      locale,
      tz,
      marketName,
      userName,
      owner: view.role === "owner",
      day: isDayWindow(w),
      phone,
      hm,
      timeOf,
      dayOf,
      ago,
      when,
      prevName,
      periodLabel: windowLabel({ t, f }, w),
      href: (path: string) => `/${locale}/${path}`,
    };
  }, [view, state, setState, t, loc, locale, tz, marketName, userName, phone]);

  const perfHref = useCallback(
    (id: string) => {
      const q = new URLSearchParams();
      // Performance › Commandes reads multi-day periods; a day opens on its default.
      if (state.period !== "today" && state.period !== "yesterday") q.set("period", state.period);
      if (state.period === "custom" && state.from && state.to) {
        q.set("from", state.from);
        q.set("to", state.to);
      }
      q.set("boutique", id);
      return `/${locale}/performance/orders?${q.toString()}`;
    },
    [locale, state],
  );
  const openStore = useCallback((id: string) => (phone ? setSheet(id) : router.push(perfHref(id))), [phone, router, perfHref]);

  if (!ctx) {
    return (
      <div className="sdb" ref={rootRef}>
        <div className="page">
          {error ? (
            <div className="err">{t("head.error")}</div>
          ) : (
            <div role="status" aria-busy="true" style={{ display: "contents" }}>
              <span className="sr-only">{t("head.loading")}</span>
              <HomeSkeleton />
            </div>
          )}
        </div>
      </div>
    );
  }

  const age = Math.floor((clock - Date.parse(ctx.view.now)) / 60_000);
  const stale = age >= STALE_MIN ? age : null;
  const sheetStore = sheet ? ctx.view.stores.find((x) => x.id === sheet) : null;
  const dateSheet = phone && dp;

  return (
    <HomeProvider value={ctx}>
      <div className="sdb" ref={rootRef} onMouseMove={onMove} onPointerDown={onDown} onClick={onClick}>
        <div className={`page${isLoading ? " loading" : ""}`}>
          <Header dp={dp} setDp={setDp} stale={stale} onRefresh={() => void mutate()} />
          {error && <div className="err">{t("head.error")}</div>}
          <Hero />
          <StoresBlock onOpen={openStore} view={mode} setView={setMode} />
        </div>
        {(sheetStore || dateSheet) && (
          <>
            <div
              className="scrim"
              onClick={() => {
                setSheet(null);
                setDp(null);
              }}
            />
            <div className="sheet" role="dialog" aria-modal="true" aria-label={sheetStore ? sheetStore.name : t("dp.dialog")}>
              <div className="grab" />
              <div className="sh-h">
                <b>{sheetStore ? sheetStore.name : t("dp.dialog")}</b>
                <button
                  type="button"
                  className="x"
                  aria-label={t("stores.close")}
                  onClick={() => {
                    setSheet(null);
                    setDp(null);
                  }}
                >
                  <Ic n="x" />
                </button>
              </div>
              {sheetStore ? (
                <>
                  <div className="sc card" style={hueVars(sheetStore.hue)}>
                    <CardBody x={sheetStore} />
                  </div>
                  <button type="button" className="btn" onClick={() => router.push(perfHref(sheetStore.id))}>
                    {t("stores.perf")}
                    <Ic n="arrow" className="flipx" />
                  </button>
                </>
              ) : (
                dp && <DateSheetBody dp={dp} setDp={setDp} />
              )}
            </div>
          </>
        )}
        <div className="tip" ref={tipRef} role="tooltip" />
      </div>
    </HomeProvider>
  );
}
