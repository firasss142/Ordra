"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Clock, Inbox, Users } from "lucide-react";
import type { DayView } from "@/lib/team/room/day-view";
import { Avatar, RoomCard } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

type Tone = "warn" | "bad" | null;

function Cell({ label, icon, swatch, value, small, extra, sub, subTone = null, bad = false, title }: {
  label: string;
  icon?: ReactNode;
  swatch?: string;
  value: ReactNode;
  small?: ReactNode;
  extra?: ReactNode;
  sub: ReactNode;
  subTone?: Tone;
  bad?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0 border-s border-line-subtle px-[18px] pb-[16px] pt-[15px] first:border-s-0 max-[900px]:border-s-0 max-[900px]:border-t max-[900px]:px-[14px] max-[900px]:pb-[13px] max-[900px]:pt-[12px] max-[900px]:[&:nth-child(-n+2)]:border-t-0 max-[900px]:even:border-s">
      <div className="flex items-center gap-[7px] whitespace-nowrap text-[12.5px] font-medium text-room-ink-2">
        {swatch ? <i className={`h-[8px] w-[8px] flex-none rounded-[2px] ${swatch}`} aria-hidden="true" /> : icon}
        {label}
      </div>
      <div className={`mt-[6px] flex items-baseline gap-[6px] text-[28px] font-[650] leading-[1.1] tracking-[-0.025em] tabular-nums max-[900px]:text-[24px] ${bad ? "text-room-red" : "text-ink-primary"}`}>
        {value}
        {small !== undefined && <small className="text-[14px] font-medium tracking-normal text-room-ink-3">{small}</small>}
        {extra}
      </div>
      <div
        title={title}
        className={`mt-[4px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] ${subTone === "warn" ? "text-room-amber-ink" : subTone === "bad" ? "text-room-red" : "text-room-ink-3"}`}
      >
        {sub}
      </div>
    </div>
  );
}

const ICON = { size: 14, strokeWidth: 1.8, className: "text-room-ink-3", "aria-hidden": true } as const;

/** Six numbers for the day. prototypes/team-v5.html `renderStrip()` */
export function TodayStrip({ view, fmt }: { view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.strip");
  const tm = view.team;
  const h = view.callMin / 60;
  const cells: ReactNode[] = [];

  if (view.live) {
    const w = tm.working;
    const anyBad = tm.bad.idle + tm.bad.late + tm.bad.early > 0;
    const badLine = [
      tm.bad.idle ? t("badIdle", { n: tm.bad.idle }) : null,
      tm.bad.late ? t("badLate", { n: tm.bad.late }) : null,
      tm.bad.early ? t("badEarly", { n: tm.bad.early }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    // The prototype printed « personne n'appelle » whenever not everyone was
    // working; with two at work and one finished that was simply false.
    const sub =
      view.work === false && !w.length
        ? t("rest")
        : anyBad
          ? badLine
          : w.length === 0
            ? t("none")
            : w.length === view.rows.length
              ? t("ok")
              : t("others", { n: view.rows.length - w.length });
    cells.push(
      <Cell
        key="act"
        label={t("active")}
        icon={<Users {...ICON} />}
        value={w.length}
        small={`/ ${view.rows.length}`}
        extra={
          w.length > 0 ? (
            <span className="ms-[4px] inline-flex align-[-5px]">
              {w.slice(0, 5).map((r) => (
                <span key={r.agentId} className="-ms-[6px] rounded-full border-2 border-white first:ms-0">
                  <Avatar name={r.name} presence="working" size={22} />
                </span>
              ))}
            </span>
          ) : null
        }
        sub={sub}
        subTone={anyBad ? "warn" : null}
        title={anyBad ? view.rows.filter((r) => ["idle", "late", "early"].includes(r.state)).map((r) => r.name).join(" · ") : undefined}
      />,
    );
  } else {
    const acted = view.rows.filter((r) => r.first !== null);
    cells.push(
      <Cell
        key="act"
        label={t("active")}
        icon={<Users {...ICON} />}
        value={acted.length}
        small={`/ ${view.rows.length}`}
        sub={tm.firstAll !== null && tm.lastAll !== null ? t("came", { a: fmt.hm(tm.firstAll), b: fmt.hm(tm.lastAll) }) : t("absent")}
      />,
    );
  }

  const intakeBad = view.live && view.intakeSilentMin !== null;
  cells.push(
    <Cell
      key="recv"
      label={t("received")}
      icon={<Inbox {...ICON} />}
      value={fmt.num(tm.received)}
      bad={intakeBad}
      sub={intakeBad ? t("receivedNone", { d: fmt.dur(view.intakeSilentMin!) }) : view.live ? (tm.lastInMin !== null ? t("receivedLast", { t: fmt.hm(tm.lastInMin) }) : "—") : t("receivedDay")}
      subTone={intakeBad ? "bad" : null}
    />,
  );

  const decided = tm.up + tm.rej;
  cells.push(
    <Cell key="up" label={t("uploaded")} swatch="bg-room-teal" value={fmt.num(tm.up)} sub={decided ? t("rate", { p: fmt.pct((tm.up / decided) * 100) }) : "—"} />,
    <Cell key="rej" label={t("rejected")} swatch="bg-room-red" value={fmt.num(tm.rej)} sub={decided ? t("rate", { p: fmt.pct((tm.rej / decided) * 100) }) : "—"} />,
    <Cell key="dlv" label={t("delivered")} swatch="bg-room-green" value={fmt.num(tm.delivered)} sub={t("deliveredSub")} />,
  );

  if (view.live) {
    cells.push(
      <Cell
        key="unc"
        label={t("unc", { h })}
        icon={<Clock {...ICON} />}
        value={fmt.num(tm.unc)}
        bad={tm.unc > 0}
        sub={tm.oldest ? t("uncSub", { d: fmt.dur(tm.oldest.min), name: tm.oldest.name }) : t("uncOk")}
        subTone={tm.unc > 0 ? "bad" : null}
      />,
    );
  } else {
    cells.push(
      <Cell key="unc" label={t("uncPast", { h })} icon={<Clock {...ICON} />} value={fmt.num(tm.unc)} sub={t("uncPastSub", { n: tm.rxTotal })} />,
    );
  }

  return <RoomCard className="grid grid-cols-6 max-[900px]:grid-cols-2">{cells}</RoomCard>;
}
