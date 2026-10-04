"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Clock, Inbox, Users } from "lucide-react";
import { dayWork, type DayView, type DayWork } from "@/lib/team/room/day-view";
import { Avatar, Swatch } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

export const WORK: (keyof DayWork)[] = ["up", "rej", "prog", "todo", "late"];

/** A waffle a little wider than tall, about 340 px across whatever the count. */
function waffleSize(total: number): { cols: number; cell: number; gap: number; width: number } {
  const gap = total > 160 ? 3 : 4;
  const cols = Math.max(6, Math.min(24, Math.ceil(Math.sqrt(total * 1.7))));
  const cell = Math.max(13, Math.min(30, Math.floor((340 - (cols - 1) * gap) / cols)));
  return { cols, cell, gap, width: Math.max(280, cols * cell + (cols - 1) * gap) };
}

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
 * 1 · Today's work as a waffle — one square per order, done or still in their hands —
 * and v5's six numbers as tiles. prototypes/team-v6.html `overview()`
 */
export function TodayOverview({ view, fmt }: { view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.ov");
  const ts = useTranslations("team.room.strip");
  const [hl, setHl] = useState<keyof DayWork | null>(null);
  const live = view.live;
  const h = view.callMin / 60;
  const c = dayWork(view.rows, live);
  const total = WORK.reduce((s, k) => s + c[k], 0);
  const size = waffleSize(total);
  const label = (k: keyof DayWork) => (k === "late" ? t("late", { h }) : t(k));
  const one = (k: keyof DayWork) => (k === "late" ? t("one.late", { h }) : t(`one.${k}`));
  const tipOf = (k: keyof DayWork) => (live ? t("tipToday", { k: one(k), n: c[k] }) : t("tipPast", { k: one(k), n: c[k] }));

  const cells: ReactNode[] = [];
  let i = 0;
  for (const k of WORK) {
    const tip = tipOf(k);
    for (let j = 0; j < c[k]; j++) {
      cells.push(<i key={i} className={`r6-wc r6-k-${k}`} style={{ "--i": i } as CSSProperties} data-k={k} data-tip={tip} />);
      i += 1;
    }
  }

  const item = (k: keyof DayWork) => (
    <span key={k} data-k={k}>
      <Swatch k={k} />
      <b>{c[k]}</b>
      {label(k)}
    </span>
  );

  // the six numbers — v5's strip, as tiles
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
    <Tile key="up" k="up" label={ts("uploaded")} icon={<Swatch k="up" />} value={fmt.num(tm.up)} sub={dec ? ts("rate", { p: fmt.pct((tm.up / dec) * 100) }) : "—"} />,
    <Tile key="rej" k="rej" label={ts("rejected")} icon={<Swatch k="rej" />} value={fmt.num(tm.rej)} sub={dec ? ts("rate", { p: fmt.pct((tm.rej / dec) * 100) }) : "—"} />,
    <Tile key="dlv" label={ts("delivered")} icon={<Swatch k="del" />} value={fmt.num(tm.delivered)} sub={ts("deliveredSub")} />,
  );
  if (live) {
    tiles.push(
      <Tile
        key="unc"
        k="late"
        label={ts("unc", { h })}
        icon={<Swatch k="late" />}
        value={fmt.num(tm.unc)}
        bad={tm.unc > 0}
        sub={tm.oldest ? ts("uncSub", { d: fmt.dur(tm.oldest.min), name: tm.oldest.name }) : ts("uncOk")}
        subTone={tm.unc > 0 ? "bad" : undefined}
      />,
    );
  } else {
    tiles.push(<Tile key="unc" label={ts("uncPast", { h })} icon={<Clock {...iconCls} />} value={fmt.num(tm.unc)} sub={ts("uncPastSub", { n: tm.rxTotal })} />);
  }

  // hovering a square, a legend item or a tile lights its kind up in the waffle
  const onOver = (e: React.MouseEvent) => {
    const k = (e.target as Element).closest?.("[data-k]")?.getAttribute("data-k") as keyof DayWork | null;
    setHl(k ?? null);
  };

  return (
    <section className="r6-card r6-ov" data-hl={hl ?? undefined} onMouseOver={onOver} onMouseLeave={() => setHl(null)}>
      <div className="r6-ov-l" style={{ width: size.width }}>
        <div className="r6-ov-h">
          <h2>{t("title")}</h2>
          <span className="r6-meta">{live ? t("meta", { n: total }) : t("metaPast", { n: total })}</span>
        </div>
        {total ? (
          <div
            className="r6-waffle"
            style={{ "--cols": size.cols, "--cell": `${size.cell}px`, "--cg": `${size.gap}px` } as CSSProperties}
            role="img"
            aria-label={WORK.map((k) => `${c[k]} ${label(k)}`).join(", ")}
          >
            {cells}
          </div>
        ) : (
          <div className="r6-wempty">{t("empty")}</div>
        )}
        <div className="r6-wleg">
          <span className="r6-grp">{live ? t("grpDone") : t("grpDonePast")}</span>
          {item("up")}
          {item("rej")}
          {live && (
            <>
              <span className="r6-grp">{t("grpHand")}</span>
              {item("prog")}
              {item("todo")}
              {item("late")}
            </>
          )}
        </div>
      </div>
      <div className="r6-tiles">{tiles}</div>
    </section>
  );
}
