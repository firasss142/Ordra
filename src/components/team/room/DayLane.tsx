"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { AgentDayRow, DayView } from "@/lib/team/room/day-view";
import type { RoomFormat } from "./useRoomFormat";

/**
 * Her day, drawn like Présence: stretches on shift (her colour), dotted pauses,
 * ticks for uploads and rejections, ▼ when orders were handed to her, the planning
 * behind, a late start, a silence that is still going, and the « maintenant » line.
 * prototypes/team-v6.html `lane()`. Positions are inset-inline-start in %, so
 * Arabic mirrors without a second code path.
 */
export function DayLane({ r, view, fmt }: { r: AgentDayRow; view: DayView; fmt: RoomFormat }) {
  const t = useTranslations("team.room.lane");
  const t0 = view.t0;
  const x = (m: number) => Math.max(0, Math.min(100, ((m - t0) / (1440 - t0)) * 100));
  const at = (m: number): CSSProperties => ({ insetInlineStart: `${x(m)}%` });
  const span = (a: number, b: number): CSSProperties => ({ insetInlineStart: `${x(a)}%`, width: `${Math.max(0, x(b) - x(a))}%` });
  const work = (view.work ?? !!r.shift) && !!r.shift;
  const late = work && r.shift && ((r.lateBy !== null && r.lateBy > view.lateMin) || r.state === "late");
  const hours: number[] = [];
  for (let h = Math.ceil(t0 / 120) * 2; h <= 24; h += 2) hours.push(h);
  const lateTo = r.first ?? view.cut;

  return (
    <div className="r6-lane">
      {hours.map((h) => (
        <span key={h}>
          <i className="r6-gl" style={at(h * 60)} />
          <span className="r6-hr" style={at(h * 60)}>
            {h}&nbsp;h
          </span>
        </span>
      ))}
      {work && r.shift && <span className="r6-plan" style={span(r.shift[0], r.shift[1])} data-tip={t("plan", { a: fmt.hm(r.shift[0]), b: fmt.hm(r.shift[1]) })} />}
      {view.live && <span className="r6-fut" style={at(view.cut)} />}
      {late && r.shift && <span className="r6-lateb" style={span(r.shift[0], lateTo)} data-tip={t("late", { d: fmt.dur(lateTo - r.shift[0]) })} />}
      {r.stretches.map((g, j) => {
        const prev = r.stretches[j - 1];
        return (
          <span key={j}>
            {prev && <span className="r6-brk" style={span(prev.e, g.b)} data-tip={t("pause", { d: fmt.dur(g.b - prev.e) })} />}
            <span
              className="r6-sgm"
              style={{ ...span(g.b, g.e), animationDelay: `${j * 60}ms` }}
              data-tip={t("stretch", { a: fmt.hm(g.b), b: fmt.hm(g.e), d: fmt.dur(g.e - g.b), n: g.n })}
            />
          </span>
        );
      })}
      {r.ups.map((m, i) => (
        <i key={`u${i}`} className="r6-tk r6-u" style={at(m)} />
      ))}
      {r.events.map(([m, k], i) => (k === "r" ? <i key={`r${i}`} className="r6-tk r6-r" style={at(m)} /> : null))}
      {r.asg.map((a, i) => (
        <span key={`a${i}`} className="r6-as" style={at(a.m)} data-tip={t("asg", { n: a.n, t: fmt.hm(a.m) })}>
          {a.n > 1 ? a.n : ""}
        </span>
      ))}
      {r.state === "idle" && r.last !== null && (
        <span className="r6-idle" style={span(r.last, view.cut)}>
          <em>{fmt.dur(view.cut - r.last)}</em>
        </span>
      )}
      {view.live && r.events.length === 0 && r.seenTodayMin !== null && <span className="r6-seen" style={at(r.seenTodayMin)} data-tip={t("seen", { t: fmt.hm(r.seenTodayMin) })} />}
      {view.live && <span className="r6-nowl" style={at(view.cut)} data-tip={t("now", { t: fmt.hm(view.cut) })} />}
    </div>
  );
}
