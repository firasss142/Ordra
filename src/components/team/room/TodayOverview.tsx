"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Clock, Inbox, Truck, Users } from "lucide-react";
import { dayWork, type DayView, type DayWork } from "@/lib/team/room/day-view";
import { OutcomeRows, type OutcomeRow } from "@/components/shared/charts/OutcomeRows";
import { Avatar } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

export const WORK: (keyof DayWork)[] = ["up", "rej", "prog", "todo", "late"];

function Tile({ label, icon, value, small, extra, sub, subTone, bad = false, k, tip }: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  small?: ReactNode;
  extra?: ReactNode;
  sub: ReactNode;
  subTone?: "warn" | "bad";
  bad?: boolean;
  k?: keyof DayWork;
  tip?: string;
}) {
  return (
    <div className={`r6-tile ${bad ? "r6-bad" : ""}`} data-k={k}>
      <div className="r6-l">
        {icon}
        {label}
      </div>
      <div className="r6-v">
        <b>{value}</b>
        {small !== undefined && <small>{small}</small>}
        {extra}
      </div>
      <div className={`r6-s ${subTone ? `r6-${subTone}` : ""}`} data-tip={tip}>
        {sub}
      </div>
    </div>
  );
}

/**
 * 1 · Today's work — Aurore calme (2026-10-05): a sentence, then one bar per kind on one
 * scale (done, then still in hand; overdue in red), and the three context figures as tiles.
 */
export function TodayOverview({ view, fmt }: { view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.ov");
  const ts = useTranslations("team.room.strip");
  const live = view.live;
  const h = view.callMin / 60;
  const c = dayWork(view.rows, live);
  const total = WORK.reduce((s, k) => s + c[k], 0);
  const one = (k: keyof DayWork) => (k === "late" ? t("one.late", { h }) : t(`one.${k}`));
  const tipOf = (k: keyof DayWork) => (live ? t("tipToday", { k: one(k), n: c[k] }) : t("tipPast", { k: one(k), n: c[k] }));

  // the context figures — who works, what came in, what was delivered
  const tm = view.team;
  const tiles: ReactNode[] = [];
  const iconCls = { className: "r6-ic", "aria-hidden": true } as const;
  if (live) {
    const w = tm.working;
    const badRows = view.rows.filter((r) => r.state === "idle" || r.state === "late" || r.state === "early");
    const badLine = [
      tm.bad.idle ? ts("badIdle", { n: tm.bad.idle }) : null,
      tm.bad.late ? ts("badLate", { n: tm.bad.late }) : null,
      tm.bad.early ? ts("badEarly", { n: tm.bad.early }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    // v5's fix kept: « personne n'appelle » only when nobody is working.
    const sub = view.work === false && !w.length ? ts("rest") : badRows.length ? badLine : w.length === 0 ? ts("none") : w.length === view.rows.length ? ts("ok") : ts("others", { n: view.rows.length - w.length });
    tiles.push(
      <Tile
        key="act"
        label={ts("active")}
        icon={<Users {...iconCls} />}
        value={w.length}
        small={`/ ${view.rows.length}`}
        extra={
          w.length > 0 ? (
            <span className="r6-stk">
              {w.slice(0, 5).map((r) => (
                <Avatar key={r.agentId} name={r.name} agentId={r.agentId} color={r.color} presence="working" />
              ))}
            </span>
          ) : null
        }
        sub={sub}
        subTone={badRows.length ? "warn" : undefined}
        tip={badRows.length ? badRows.map((r) => r.name).join(" · ") : undefined}
      />,
    );
  } else {
    const acted = view.rows.filter((r) => r.first !== null);
    tiles.push(
      <Tile
        key="act"
        label={ts("active")}
        icon={<Users {...iconCls} />}
        value={acted.length}
        small={`/ ${view.rows.length}`}
        sub={tm.firstAll !== null && tm.lastAll !== null ? ts("came", { a: fmt.hm(tm.firstAll), b: fmt.hm(tm.lastAll) }) : ts("absent")}
      />,
    );
  }
  const intakeBad = live && view.intakeSilentMin !== null;
  const dec = tm.up + tm.rej;
  tiles.push(
    <Tile
      key="recv"
      label={ts("received")}
      icon={<Inbox {...iconCls} />}
      value={fmt.num(tm.received)}
      bad={intakeBad}
      sub={intakeBad ? ts("receivedNone", { d: fmt.dur(view.intakeSilentMin!) }) : live ? (tm.lastInMin !== null ? ts("receivedLast", { t: fmt.hm(tm.lastInMin) }) : "—") : ts("receivedDay")}
      subTone={intakeBad ? "bad" : undefined}
    />,
    <Tile key="dlv" label={ts("delivered")} icon={<Truck {...iconCls} />} value={fmt.num(tm.delivered)} sub={ts("deliveredSub")} />,
  );
  if (!live) {
    tiles.push(<Tile key="unc" label={ts("uncPast", { h })} icon={<Clock {...iconCls} />} value={fmt.num(tm.unc)} sub={ts("uncPastSub", { n: tm.rxTotal })} />);
  }

  const done = c.up + c.rej, hand = c.prog + c.todo + c.late;
  const rows: OutcomeRow[] = (live ? WORK : (["up", "rej"] as const)).map((k) => ({
    key: k,
    label: k === "late" ? t("rows.late", { h }) : t(`rows.${k}`),
    color: `var(--w-${k})`,
    n: c[k],
    tip: tipOf(k),
    alert: k === "late" && c.late > 0,
    hint:
      k === "up" || k === "rej"
        ? dec ? ts("rate", { p: fmt.pct(((k === "up" ? tm.up : tm.rej) / dec) * 100) }) : undefined
        : k === "late"
          ? tm.oldest ? ts("uncSub", { d: fmt.dur(tm.oldest.min), name: tm.oldest.name }) : t("hint.lateOk", { h })
          : t(`hint.${k}`),
  }));

  return (
    <section className="r6-card r6-ov">
      <div className="r6-ov-l">
        <div className="r6-ov-h">
          <h2>{t("title")}</h2>
          <span className="r6-meta">{live ? t("meta", { n: total }) : t("metaPast", { n: total })}</span>
        </div>
        {total ? (
          <>
            <p className="r6-lede">{live ? t.rich("lede", { done, hand, b: (c) => <b>{c}</b> }) : t.rich("ledePast", { done, b: (c) => <b>{c}</b> })}</p>
            <OutcomeRows label={t("title")} rows={rows} total={total} num={fmt.num} />
          </>
        ) : (
          <div className="r6-wempty">{t("empty")}</div>
        )}
      </div>
      <div className="r6-tiles">{tiles}</div>
    </section>
  );
}
