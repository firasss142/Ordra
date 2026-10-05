"use client";

// The one date button and its popover (prototype `header` / `datePop` / `cal`):
// shortcuts (« Aujourd'hui » first), whole months, a two-month calendar —
// Performance › Commandes' button, so both pages pick dates the same way.

import { useState } from "react";
import {
  addMonths,
  daysLen,
  lastDayOfMonth,
  nameRange,
  presetRange,
  shiftDays,
  wholeMonths,
} from "@/lib/performance/orders/period";
import type { DashWindow } from "@/lib/dashboard/stores/period";
import { Ic, NB, useHome } from "./ui";

export interface DpState {
  s: string | null;
  e: string | null;
  /** The month shown on the left. */
  m: string;
}

const PRESETS = ["7d", "30d", "90d", "month"] as const;

export function openDp(w: DashWindow, first: string): DpState {
  let m = addMonths(w.to.slice(0, 7), -1);
  if (m < first.slice(0, 7)) m = first.slice(0, 7);
  return { s: w.from, e: w.to, m };
}

export function useWindowLabel() {
  const { t, f } = useHome();
  return (w: DashWindow) => {
    if (w.key === "today" || (PRESETS as readonly string[]).includes(w.key)) return t(`period.${w.key}`);
    if (w.key.startsWith("m:")) return t("period.monthYear", { month: f.month(w.key.slice(2), true), year: w.key.slice(2, 6) });
    return t("period.days", { n: w.len });
  };
}

export function DateButton({ dp, setDp }: { dp: DpState | null; setDp: (d: DpState | null) => void }) {
  const c = useHome();
  const { view, t, f } = c;
  const w = view.window;
  const label = useWindowLabel()(w);
  const range = w.key === "today" ? t("period.todayRange", { day: f.day(view.today), time: c.hm(view.nowMin) }) : f.range(w.from, w.to);
  const prev =
    w.prev.kind === "days"
      ? t("period.prevDays", { n: w.prev.len })
      : w.prev.kind === "month"
        ? t("period.prevMonth", { month: f.month(w.prev.month) })
        : w.prev.kind === "monthStart"
          ? t("period.prevMonthStart", { month: f.month(w.prev.month) })
          : "";
  const cmp =
    w.pf < view.first
      ? t("head.cmpNone", { first: f.day(view.first) })
      : w.key === "today"
        ? t("head.cmpToday", { time: c.hm(view.nowMin) })
        : t("head.cmpLine", { prev, range: f.range(w.pf, w.pt) });
  return (
    <div className="dwrap">
      <button type="button" className={`dbtn${dp ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={!!dp} data-tip={dp ? undefined : cmp} onClick={() => setDp(dp ? null : openDp(w, view.first))}>
        <Ic n="cal" />
        <span>
          <b>{label}</b>
          <small>{range}</small>
        </span>
        <Ic n="down" />
      </button>
      {dp && <DatePopover dp={dp} setDp={setDp} />}
    </div>
  );
}

function DatePopover({ dp, setDp }: { dp: DpState; setDp: (d: DpState | null) => void }) {
  const { view, state, t, f, setState } = useHome();
  const [hover, setHover] = useState<string | null>(null);
  const { today, first, window: w } = view;

  const pick = (k: string) => {
    setDp(null);
    setState({ ...state, period: k as typeof state.period, from: null, to: null });
  };

  const quick = [
    { k: "today", label: t("period.today"), r: { from: today, to: today }, hint: "" },
    ...PRESETS.map((k) => ({ k, label: t(`period.${k}`), r: presetRange(k, today, first), hint: "" })),
  ];
  const months = wholeMonths(today, first).map((m) => ({
    k: `m:${m}`,
    label: t("period.monthYear", { month: f.month(m, true), year: m.slice(0, 4) }),
    r: presetRange(`m:${m}`, today, first),
    hint: `${m}-01` < first ? t("dp.sinceFirst", { day: f.day(first) }) : "",
  }));

  const item = (it: { k: string; label: string; r: { from: string; to: string }; hint: string }) => (
    <button key={it.k} type="button" className={`dp-it${w.key === it.k ? " on" : ""}`} onClick={() => pick(it.k)}>
      <span>{it.label}</span>
      <small>{it.hint || f.range(it.r.from, it.r.to)}</small>
    </button>
  );

  const clickDay = (x: string) => {
    if (!dp.s || dp.e) setDp({ ...dp, s: x, e: null });
    else if (x < dp.s) setDp({ ...dp, s: x, e: dp.s });
    else setDp({ ...dp, e: x });
  };
  const apply = () => {
    if (!dp.s || !dp.e) return;
    const k = dp.s === today && dp.e === today ? "today" : nameRange(dp.s, dp.e, today, first);
    setDp(null);
    setState({ ...state, period: k, from: k === "custom" ? dp.s : null, to: k === "custom" ? dp.e : null });
  };

  const len = dp.s && dp.e ? daysLen(dp.s, dp.e) : 0;
  const wd = t("dp.weekdays").split(",");

  const cal = (m: string, side: -1 | 1) => {
    const firstDay = `${m}-01`;
    const last = lastDayOfMonth(m);
    const lead = (new Date(`${firstDay}T12:00:00Z`).getUTCDay() + 6) % 7;
    const prevOff = lastDayOfMonth(addMonths(m, -1)) < first;
    const nextOff = m >= today.slice(0, 7);
    const cells = [];
    for (let x = firstDay; x <= last; x = shiftDays(x, 1)) {
      const dis = x < first || x > today;
      const hv = !!dp.s && !dp.e && !!hover && ((x > dp.s && x <= hover) || (x < dp.s && x >= hover));
      const cls = [
        dis && "c-dis",
        x === today && "c-today",
        dp.s === x && "c-st",
        dp.e === x && "c-en",
        dp.s && dp.e && x > dp.s && x < dp.e && "c-in",
        hv && "c-hv",
      ]
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
            <button type="button" className="cal-nav" aria-label={t("dp.prevMonth")} disabled={prevOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, -1) })}>
              <Ic n="left" />
            </button>
          ) : (
            <span />
          )}
          <b>
            {f.month(m, true)} {m.slice(0, 4)}
          </b>
          {side > 0 ? (
            <button type="button" className="cal-nav" aria-label={t("dp.nextMonth")} disabled={nextOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, 1) })}>
              <Ic n="right" />
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

  return (
    <div className="dp" role="dialog" aria-label={t("dp.dialog")}>
      <div className="dp-side">
        <h6>{t("dp.quick")}</h6>
        {quick.map(item)}
        {months.length > 0 && <h6>{t("dp.months")}</h6>}
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
              {t.rich("dp.footRange", { range: f.range(dp.s, dp.e), n: len, b: (ch) => <b>{ch}</b> })}
              <small>{t("dp.footArrows", { n: len })}</small>
            </span>
          ) : (
            <span>
              {t.rich("dp.footStart", { day: dp.s ? f.day(dp.s) : NB, b: (ch) => <b>{ch}</b> })}
              <small>{t("dp.footStartHint")}</small>
            </span>
          )}
          <span className="dp-btns">
            <button type="button" className="chipb" onClick={() => setDp(null)}>
              {t("dp.cancel")}
            </button>
            <button type="button" className="btn" disabled={!dp.s || !dp.e} onClick={apply}>
              {t("dp.apply")}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
