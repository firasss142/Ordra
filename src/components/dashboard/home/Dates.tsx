"use client";

// The one date button and its popover — the deployed button (owner, 2026-10-07: « keep the
// deployed date button »), with « Hier » joining the shortcuts (prototypes/dashboard-v9.html
// `moreItems`). Desktop: shortcuts, whole months, a two-month calendar. Phone: the same list
// in a bottom sheet, and one month at a time.

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
import type { DashKey, DashWindow } from "@/lib/dashboard/stores/period";
import { Ic, NB, useHome } from "./ui";

export interface DpState {
  s: string | null;
  e: string | null;
  /** The month shown on the left (desktop) or alone (phone). */
  m: string;
  /** Phone: the calendar is open instead of the list. */
  cal?: boolean;
}

const PRESETS = ["7d", "30d", "90d", "month"] as const;

export function openDp(w: DashWindow, first: string, phone: boolean): DpState {
  let m = phone ? w.to.slice(0, 7) : addMonths(w.to.slice(0, 7), -1);
  if (m < first.slice(0, 7)) m = first.slice(0, 7);
  return { s: phone ? null : w.from, e: phone ? null : w.to, m };
}

export function windowLabel(c: Pick<ReturnType<typeof useHome>, "t" | "f">, w: DashWindow): string {
  if (w.key === "today" || w.key === "yesterday" || (PRESETS as readonly string[]).includes(w.key)) return c.t(`period.${w.key}`);
  if (w.key.startsWith("m:")) return c.t("period.monthYear", { month: c.f.month(w.key.slice(2), true), year: w.key.slice(2, 6) });
  return c.f.range(w.from, w.to);
}

export function DateButton({ dp, setDp }: { dp: DpState | null; setDp: (d: DpState | null) => void }) {
  const c = useHome();
  const { view, t, f } = c;
  const w = view.window;
  const sub = w.key === "today" ? `${f.day(view.today)} · ${t("head.until", { time: c.hm(view.nowMin) })}` : f.range(w.from, w.to);
  return (
    <div className="periods">
      <button type="button" className={`dbtn${dp ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={!!dp} onClick={() => setDp(dp ? null : openDp(w, view.first, c.phone))}>
        <Ic n="cal" />
        <span>
          <b>{c.periodLabel}</b>
          <small>{sub}</small>
        </span>
        <Ic n="down" />
      </button>
      {dp && !c.phone && <DatePopover dp={dp} setDp={setDp} />}
    </div>
  );
}

function useQuick() {
  const { view, t, f } = useHome();
  const { today, first } = view;
  const y = shiftDays(today, -1);
  const quick = [
    { k: "today", label: t("period.today"), hint: f.day(today) },
    { k: "yesterday", label: t("period.yesterday"), hint: f.day(y) },
    ...PRESETS.map((k) => {
      const r = presetRange(k, today, first);
      return { k, label: t(`period.${k}`), hint: f.range(r.from, r.to) };
    }),
  ];
  const months = wholeMonths(today, first).map((m) => {
    const r = presetRange(`m:${m}`, today, first);
    return {
      k: `m:${m}`,
      label: t("period.monthYear", { month: f.month(m, true), year: m.slice(0, 4) }),
      hint: `${m}-01` < first ? t("dp.sinceFirst", { day: f.day(first) }) : f.range(r.from, r.to),
    };
  });
  return { quick, months };
}

function useApply(dp: DpState, setDp: (d: DpState | null) => void) {
  const { view, state, setState } = useHome();
  const { today, first } = view;
  const pick = (k: string) => {
    setDp(null);
    setState({ ...state, period: k as DashKey, from: null, to: null });
  };
  const apply = () => {
    if (!dp.s || !dp.e) return;
    const k: DashKey =
      dp.s === today && dp.e === today ? "today" : dp.s === dp.e && dp.s === shiftDays(today, -1) ? "yesterday" : nameRange(dp.s, dp.e, today, first);
    setDp(null);
    setState({ ...state, period: k, from: k === "custom" ? dp.s : null, to: k === "custom" ? dp.e : null });
  };
  const clickDay = (x: string) => {
    if (!dp.s || dp.e) setDp({ ...dp, s: x, e: null });
    else if (x < dp.s) setDp({ ...dp, s: x, e: dp.s });
    else setDp({ ...dp, e: x });
  };
  return { pick, apply, clickDay };
}

/** One month of the calendar. */
function Month({ m, dp, setDp, hover, setHover, prev, next }: {
  m: string;
  dp: DpState;
  setDp: (d: DpState | null) => void;
  hover: string | null;
  setHover: (d: string | null) => void;
  prev: boolean;
  next: boolean;
}) {
  const { view, t, f } = useHome();
  const { today, first } = view;
  const { clickDay } = useApply(dp, setDp);
  const firstDay = `${m}-01`;
  const last = lastDayOfMonth(m);
  const lead = (new Date(`${firstDay}T12:00:00Z`).getUTCDay() + 6) % 7;
  const prevOff = lastDayOfMonth(addMonths(dp.m, -1)) < first;
  const nextOff = addMonths(dp.m, 1) > today.slice(0, 7) || m >= today.slice(0, 7);
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
    <div className="cal">
      <div className="cal-h">
        {prev ? (
          <button type="button" className="cal-nav" aria-label={t("dp.prevMonth")} disabled={prevOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, -1) })}>
            <Ic n="left" />
          </button>
        ) : (
          <span />
        )}
        <b>
          {f.month(m, true)} {m.slice(0, 4)}
        </b>
        {next ? (
          <button type="button" className="cal-nav" aria-label={t("dp.nextMonth")} disabled={nextOff} onClick={() => setDp({ ...dp, m: addMonths(dp.m, 1) })}>
            <Ic n="right" />
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="cal-g" onMouseLeave={() => setHover(null)}>
        {t("dp.weekdays")
          .split(",")
          .map((x, i) => (
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
}

function CalFoot({ dp, setDp }: { dp: DpState; setDp: (d: DpState | null) => void }) {
  const { t, f } = useHome();
  const { apply } = useApply(dp, setDp);
  const len = dp.s && dp.e ? daysLen(dp.s, dp.e) : 0;
  return (
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
        <button type="button" className="btn ghost" onClick={() => setDp(null)}>
          {t("dp.cancel")}
        </button>
        <button type="button" className="btn" disabled={!dp.s || !dp.e} onClick={apply}>
          {t("dp.apply")}
        </button>
      </span>
    </div>
  );
}

function DatePopover({ dp, setDp }: { dp: DpState; setDp: (d: DpState | null) => void }) {
  const { view, t } = useHome();
  const [hover, setHover] = useState<string | null>(null);
  const { quick, months } = useQuick();
  const { pick } = useApply(dp, setDp);
  const item = (it: { k: string; label: string; hint: string }) => (
    <button key={it.k} type="button" className={`dp-it${view.window.key === it.k ? " on" : ""}`} onClick={() => pick(it.k)}>
      <span>{it.label}</span>
      <small>{it.hint}</small>
    </button>
  );
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
          <Month m={dp.m} dp={dp} setDp={setDp} hover={hover} setHover={setHover} prev next={false} />
          <Month m={addMonths(dp.m, 1)} dp={dp} setDp={setDp} hover={hover} setHover={setHover} prev={false} next />
        </div>
        <CalFoot dp={dp} setDp={setDp} />
      </div>
    </div>
  );
}

/** Phone: the bottom sheet's body — the list, or one month of the calendar. */
export function DateSheetBody({ dp, setDp }: { dp: DpState; setDp: (d: DpState | null) => void }) {
  const { view, t } = useHome();
  const [hover, setHover] = useState<string | null>(null);
  const { quick, months } = useQuick();
  const { pick } = useApply(dp, setDp);
  if (dp.cal) {
    return (
      <div className="sh-cal">
        <Month m={dp.m} dp={dp} setDp={setDp} hover={hover} setHover={setHover} prev next />
        <CalFoot dp={dp} setDp={setDp} />
      </div>
    );
  }
  const item = (it: { k: string; label: string; hint: string }) => (
    <button key={it.k} type="button" className={`pi${view.window.key === it.k ? " on" : ""}`} onClick={() => pick(it.k)}>
      <span>{it.label}</span>
      <small>{it.hint}</small>
    </button>
  );
  return (
    <>
      <h6>{t("dp.quick")}</h6>
      {quick.map(item)}
      {months.length > 0 && (
        <>
          <div className="sep" />
          <h6>{t("dp.months")}</h6>
        </>
      )}
      {months.map(item)}
      <div className="sep" />
      <button type="button" className="pi" onClick={() => setDp({ ...dp, cal: true })}>
        <span>{t("dp.custom")}</span>
        <Ic n="cal" />
      </button>
    </>
  );
}
