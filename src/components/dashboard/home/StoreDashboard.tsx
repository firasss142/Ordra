"use client";

// Accueil « vos boutiques » (prototypes/dashboard-v2.html, plans/dashboard-redesign.md).
//
// The page's state lives in its URL (?period=…&from=&to=&sort=); every figure
// comes computed from GET /api/dashboard/stores — nothing is counted, and no
// price is summed, in the browser. SWR keeps the previous figures on screen
// while another period loads.

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import { parseDashState, type DashState } from "@/lib/dashboard/stores/period";
import type { StoreDashView } from "@/lib/dashboard/stores/view";
import { type DpState } from "./Dates";
import { AllStores, Banner, Defs, Header, StoresBlock, type Sort } from "./Blocks";
import { HomeProvider, glue, makeFmt, type HomeCtx, type Loc } from "./ui";
import "./store-dashboard.css";

function stateToParams(s: DashState, sort: Sort): URLSearchParams {
  const q = new URLSearchParams();
  if (s.period !== "today") q.set("period", s.period);
  if (s.period === "custom" && s.from && s.to) {
    q.set("from", s.from);
    q.set("to", s.to);
  }
  if (sort !== "cmd") q.set("sort", sort);
  return q;
}

const SORTS: readonly Sort[] = ["cmd", "liv", "paye"];

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
  const [sort, setSortLocal] = useState<Sort>(() => {
    const s = sp.get("sort");
    return (SORTS as readonly string[]).includes(s ?? "") ? (s as Sort) : "cmd";
  });
  const [dp, setDp] = useState<DpState | null>(null);
  const [pop, setPop] = useState(false);
  const loc: Loc = locale === "ar" ? "ar" : "fr";

  const writeUrl = useCallback((s: DashState, so: Sort) => {
    const q = stateToParams(s, so).toString();
    window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
  }, []);
  const setState = useCallback(
    (next: DashState) => {
      setLocal(next);
      setPop(false);
      writeUrl(next, sort);
    },
    [sort, writeUrl],
  );
  const setSort = (s: Sort) => {
    setSortLocal(s);
    writeUrl(state, s);
  };

  const query = useMemo(() => {
    const q = stateToParams(state, "cmd");
    q.set("market_id", marketId);
    return q.toString();
  }, [state, marketId]);
  const { data: view, error, isLoading } = useSWR<StoreDashView>(`/api/dashboard/stores?${query}`, jsonFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    refreshInterval: state.period === "today" ? 60_000 : 0,
  });

  // ── tooltips + « hover a store anywhere, it lights up in both places » ──
  const tipRef = useRef<HTMLDivElement>(null);
  const onOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const st = target.closest?.("#mix [data-store], .sc[data-store]") as HTMLElement | null;
    const key = st?.dataset.store ?? null;
    const fromMix = !!st?.closest("#mix");
    const cards = document.getElementById("cards");
    const mix = document.getElementById("mix");
    if (cards) {
      if (key && fromMix) cards.dataset.hl = key;
      else delete cards.dataset.hl;
    }
    if (mix) {
      if (key) mix.dataset.hl = key;
      else delete mix.dataset.hl;
    }
    document.querySelectorAll<HTMLElement>(".sdb .sc").forEach((el) => el.classList.toggle("hl", !!key && el.dataset.store === key));
    document.querySelectorAll<HTMLElement>("#mix [data-store]").forEach((el) => el.classList.toggle("hl", !!key && el.dataset.store === key));

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
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = e.clientX + 14;
    let y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDp(null);
        setPop(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (dp && !target.closest(".dp, .dbtn")) setDp(null);
    if (pop && !target.closest(".pop, [data-pop]")) setPop(false);
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
    const ago = (iso: string | null) => {
      if (!iso) return t("card.none");
      const mins = Math.floor((nowMs - Date.parse(iso)) / 60_000);
      const d = dayOf(iso);
      const days = Math.round((Date.parse(view.today) - Date.parse(d)) / 86_400_000);
      if (mins < 60) return t("card.agoMin", { n: f.n(Math.max(1, mins)) });
      if (days === 0) return t("card.agoH", { n: f.n(Math.floor(mins / 60)) });
      if (days === 1) return t("card.agoYesterday", { time: timeOf(iso) });
      if (days < 7) return t("card.agoD", { n: f.n(days) });
      return t("card.agoDay", { day: f.day(d) });
    };
    const w = view.window;
    const prevName =
      w.prev.kind === "days"
        ? t("period.nameDays", { n: w.prev.len })
        : w.prev.kind === "month"
          ? t("period.nameMonth", { month: f.month(w.prev.month) })
          : w.prev.kind === "monthStart"
            ? t("period.nameMonthStart", { month: f.month(w.prev.month) })
            : t("period.nameYesterday");
    const isToday = w.key === "today";
    return {
      view,
      state,
      setState,
      t,
      f,
      locale,
      tz,
      marketName,
      userName,
      owner: view.role === "owner",
      isToday,
      hm,
      timeOf,
      dayOf,
      ago,
      prevName,
      sameAge: isToday ? prevName : t("period.sameAge", { prev: prevName, day: f.day(view.asOfP) }),
      href: (path: string) => `/${locale}/${path}`,
    };
  }, [view, state, setState, t, loc, locale, tz, marketName, userName]);

  const openStore = useCallback(
    (id: string) => {
      const q = new URLSearchParams();
      if (state.period !== "today") q.set("period", state.period);
      if (state.period === "custom" && state.from && state.to) {
        q.set("from", state.from);
        q.set("to", state.to);
      }
      q.set("boutique", id);
      router.push(`/${locale}/performance/orders?${q.toString()}`);
    },
    [router, locale, state],
  );

  const goTo = (id: string) => {
    const card = document.querySelector<HTMLElement>(`.sdb [data-card="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1400);
  };

  if (!ctx) {
    return (
      <div className="sdb">
        <div className="page">
          {error ? (
            <div className="err">{t("head.error")}</div>
          ) : (
            <>
              <div className="sk" style={{ height: 70, background: "transparent", border: 0, boxShadow: "none" }} aria-busy="true">
                <span className="meta">{t("head.loading")}</span>
              </div>
              <div className="sk" style={{ height: 380 }} />
              <div className="sk" style={{ height: 520 }} />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <HomeProvider value={ctx}>
      <div className="sdb" onMouseOver={onOver} onMouseMove={onMove} onClick={onClick}>
        <div className={`page${isLoading ? " loading" : ""}`}>
          <Header dp={dp} setDp={setDp} />
          {error && <div className="err">{t("head.error")}</div>}
          <Banner />
          <AllStores pop={pop} setPop={setPop} onGo={goTo} />
          <StoresBlock sort={sort} setSort={setSort} onOpen={openStore} />
          <Defs />
        </div>
        <div className="tip" ref={tipRef} />
      </div>
    </HomeProvider>
  );
}
