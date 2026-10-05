"use client";

// The date button and its popover (prototype `tools` / `datePop` / `cal`): the
// one of Accueil and Performance, with « Toutes les dates » first. Picks
// market-local days; the list route cuts them at the market's midnight.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { addMonths, daysLen, lastDayOfMonth, shiftDays } from "@/lib/performance/orders/period";
import { LIST_PRESETS, periodOf, presetDates, wholeMonthsBack, type ListPeriod } from "@/lib/orders/list-period";
import type { Fmt } from "@/components/performance/orders/ui";
import { Ic } from "./ui";

interface Props {
  from: string | null;
  to: string | null;
  today: string;
  /** The market's first order day — the calendar starts there. */
  first: string | null;
  f: Fmt;
  onChange: (from: string | null, to: string | null) => void;
}

interface Dp {
  s: string | null;
  e: string | null;
  m: string;
}

export function useWindowLabel(f: Fmt, today: string) {
  const t = useTranslations("commandes.dates");
  return (from: string | null, to: string | null) => {
    const k: ListPeriod = periodOf(from, to, today);
    if (k === "all") return t("all");
    if (k.startsWith("m:")) return t("monthYear", { month: f.month(k.slice(2), true), year: k.slice(2, 6) });
    if (k === "custom") return t("days", { n: from && to ? daysLen(from, to) : 0 });
    return t(k);
  };
}

export function DateButton({ from, to, today, first, f, onChange }: Props) {
  const t = useTranslations("commandes.dates");
  const label = useWindowLabel(f, today)(from, to);
  const [dp, setDp] = useState<Dp | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dp) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setDp(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDp(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [dp]);

  const sub = !from && !to ? (first ? t("since", { day: f.day(first) }) : t("sinceStart")) : f.range(from ?? first ?? today, to ?? today);

  const open = () => {
    const end = to ?? today;
    let m = addMonths(end.slice(0, 7), -1);
    if (first && m < first.slice(0, 7)) m = first.slice(0, 7);
    setDp({ s: from, e: to, m });
  };

  return (
    <div className="dwrap" ref={wrap}>
      <button
        type="button"
        className={`dbtn${dp ? " on" : ""}${from || to ? " set" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={!!dp}
        onClick={() => (dp ? setDp(null) : open())}
      >
        <Ic n="cal" />
        <span>
          <b>{label}</b>
          <small>{sub}</small>
        </span>
        <Ic n="down" />
      </button>
      {dp && (
        <Popover
          dp={dp}
          setDp={setDp}
          today={today}
          first={first}
          f={f}
          current={periodOf(from, to, today)}
          pick={(a, b) => {
            setDp(null);
            onChange(a, b);
          }}
        />
      )}
    </div>
  );
}

function Popover({
  dp,
  setDp,
  today,
  first,
  f,
  current,
  pick,
}: {
  dp: Dp;
  setDp: (d: Dp | null) => void;
  today: string;
  first: string | null;
  f: Fmt;
  current: ListPeriod;
  pick: (from: string | null, to: string | null) => void;
}) {
  const t = useTranslations("commandes.dates");
  const [hover, setHover] = useState<string | null>(null);
  const floor = first ?? "2000-01-01";

  const quick = LIST_PRESETS.map((k) => {
    const r = presetDates(k, today);
    return { k, label: t(k), hint: k === "all" ? (first ? t("since", { day: f.day(first) }) : t("sinceStart")) : f.range(r.from!, r.to!), r };
  });
  const months = wholeMonthsBack(today).map((m) => {
    const r = presetDates(`m:${m}`, today);
    return { k: `m:${m}`, label: t("monthYear", { month: f.month(m, true), year: m.slice(0, 4) }), hint: "", r };
  });

  const item = (it: { k: string; label: string; hint: string; r: { from: string | null; to: string | null } }) => (
    <button key={it.k} type="button" className={`dp-it${current === it.k ? " on" : ""}`} onClick={() => pick(it.r.from, it.r.to)}>
      <span>{it.label}</span>
      {it.hint && <small>{it.hint}</small>}
    </button>
  );

  const clickDay = (x: string) => {
    if (!dp.s || dp.e) setDp({ ...dp, s: x, e: null });
    else if (x < dp.s) setDp({ ...dp, s: x, e: dp.s });
    else setDp({ ...dp, e: x });
  };

  const wd = t("weekdays").split(",");
  const cal = (m: string, side: -1 | 1) => {
    const firstDay = `${m}-01`;
    const last = lastDayOfMonth(m);
    const lead = (new Date(`${firstDay}T12:00:00Z`).getUTCDay() + 6) % 7;
    const prevOff = lastDayOfMonth(addMonths(m, -1)) < floor;
    const nextOff = m >= today.slice(0, 7);
    const cells = [];
    for (let x = firstDay; x <= last; x = shiftDays(x, 1)) {
      const dis = x < floor || x > today;
      const hv = !!dp.s && !dp.e && !!hover && ((x > dp.s && x <= hover) || (x < dp.s && x >= hover));
      const cls = [dis && "c-dis", x === today && "c-today", dp.s === x && "c-st", dp.e === x && "c-en", dp.s && dp.e && x > dp.s && x < dp.e && "c-in", hv && "c-hv"]
        .filter(Boolean)
        .join(" ");
      cells.push(
        <button key={x} type="button" className={`cal-d ${cls}`} disabled={dis} aria-label={f.dayLong(x)} onClick={() => clickDay(x)} onMouseEnter={() => setHover(x)}>
          {+x.slice(8)}
        </button>,
      );
    }
    return (
      <div className="cal" key={m}>
        <div className="cal-h">
          {side < 0 ? (
            <button type="button" className="cal-nav" aria-label={t("prevMonth")} disabled={prevOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, -1) })}>
              <Ic n="left" className="flip" />
            </button>
          ) : (
            <span />
          )}
          <b>
            {f.month(m, true)} {m.slice(0, 4)}
          </b>
          {side > 0 ? (
            <button type="button" className="cal-nav" aria-label={t("nextMonth")} disabled={nextOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, 1) })}>
              <Ic n="right" className="flip" />
            </button>
          ) : (
            <span />
          )}
        </div>
        <div className="cal-g" onMouseLeave={() => setHover(null)}>
          {wd.map((x, i) => (
            <span key={i} className="cal-w">
              {x}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {cells}
        </div>
      </div>
    );
  };

  const len = dp.s && dp.e ? daysLen(dp.s, dp.e) : 0;
  return (
    <div className="dp" role="dialog" aria-label={t("dialog")}>
      <div className="dp-side">
        <h6>{t("quick")}</h6>
        {quick.map(item)}
        <h6>{t("months")}</h6>
        {months.map(item)}
      </div>
      <div className="dp-main">
        <div className="dp-cals">
          {cal(dp.m, -1)}
          {cal(addMonths(dp.m, 1), 1)}
        </div>
        <div className="dp-foot">
          {dp.s && dp.e ? (
            <span>
              {t.rich("footRange", { range: f.range(dp.s, dp.e), n: len, b: (c) => <b>{c}</b> })}
              <small>{t("footHint")}</small>
            </span>
          ) : dp.s ? (
            <span>
              {t.rich("footFrom", { day: f.day(dp.s), b: (c) => <b>{c}</b> })}
              <small>{t("footFromHint")}</small>
            </span>
          ) : (
            <span>{t("footStart")}</span>
          )}
          <span className="dp-btns">
            <button type="button" className="btn2" onClick={() => setDp(null)}>
              {t("cancel")}
            </button>
            <button type="button" className="btn" disabled={!dp.s || !dp.e} onClick={() => dp.s && dp.e && pick(dp.s, dp.e)}>
              {t("apply")}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
