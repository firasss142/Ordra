"use client";

import type { AgentDayRow, DayView } from "@/lib/team/room/day-view";
import type { RoomFormat } from "./useRoomFormat";

/**
 * Her day on one line: planned hours (dashed box), sessions (grey band), calls
 * (ticks), uploads (teal) and rejections (red), assignments (▼ n), a late start
 * (dotted amber), a silence that is still going (dashed amber), and now.
 * prototypes/team-v5.html `laneHtml()`. Positions are inset-inline-start in %,
 * so Arabic mirrors without a second code path.
 */
export function DayLane({ r, view, fmt }: { r: AgentDayRow; view: DayView; fmt: RoomFormat }) {
  const t0 = view.t0;
  const span = 1440 - t0;
  const x = (m: number) => Math.max(0, Math.min(100, ((m - t0) / span) * 100));
  const at = (m: number) => ({ insetInlineStart: `${x(m)}%` });
  const hours: number[] = [];
  for (let h = Math.ceil(t0 / 120) * 2; h < 24; h += 2) hours.push(h);
  const axis: number[] = [];
  for (let h = Math.ceil(t0 / 120) * 2; h <= 24; h += 2) axis.push(h);
  const work = view.work ?? !!r.shift;
  const late = work && r.shift && ((r.lateBy !== null && r.lateBy > view.lateMin) || r.state === "late");

  return (
    <div>
      <div className="relative h-[52px]" aria-hidden="true">
        {hours.map((h) => (
          <span key={h} className="absolute bottom-0 top-[8px] w-0 border-s border-dashed border-room-line-faint" style={at(h * 60)} />
        ))}
        {work && r.shift && (
          <span className="absolute top-[15px] h-[28px] rounded-[6px] border border-dashed border-room-plan bg-[rgba(197,202,208,.08)]" style={{ ...at(r.shift[0]), width: `${x(r.shift[1]) - x(r.shift[0])}%` }} />
        )}
        {view.live && (
          <span
            className="absolute bottom-[2px] end-0 top-[8px]"
            style={{ insetInlineStart: `${x(view.cut)}%`, background: "repeating-linear-gradient(-45deg, transparent 0 5px, #F3F4F6 5px 6px)" }}
          />
        )}
        {r.sessions.map((s, i) => {
          const ongoing = view.live && i === r.sessions.length - 1 && r.state === "working";
          const b = ongoing ? view.cut : s.b + 2;
          return <span key={i} className="absolute top-[22px] h-[14px] rounded-[7px] bg-room-session" style={{ ...at(s.a - 2), width: `${Math.max(0.5, x(b) - x(s.a - 2))}%` }} />;
        })}
        {late && r.shift && (
          <span className="absolute top-[28px] h-0 border-t-2 border-dotted border-room-amber-dot" style={{ ...at(r.shift[0]), width: `${x(r.first ?? view.cut) - x(r.shift[0])}%` }} />
        )}
        {r.events.map(([m, k], i) =>
          k === "r" ? (
            <i key={i} className="absolute top-[17px] h-[24px] w-[2px] rounded-[1px] bg-room-red opacity-80" style={at(m)} />
          ) : k === "u" ? (
            <i key={i} className="absolute top-[17px] h-[24px] w-[2px] rounded-[1px] bg-room-teal" style={at(m)} />
          ) : k === "c" ? null : (
            <i key={i} className="absolute top-[25px] h-[8px] w-[2px] rounded-[1px] bg-room-tick" style={at(m)} />
          ),
        )}
        {r.asg.map((a, i) => (
          <span key={i} className="absolute top-px -ms-[4px] flex items-center gap-[2px] text-[10px] font-semibold leading-none text-room-ink-2 tabular-nums" style={at(a.m)}>
            <span className="h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-room-ink-3" />
            {a.n > 1 ? a.n : ""}
          </span>
        ))}
        {r.state === "idle" && r.last !== null && (
          <span className="absolute top-[28px] h-0 border-t-2 border-dashed border-room-amber-dot" style={{ ...at(r.last), width: `${x(view.cut) - x(r.last)}%` }}>
            <em className="absolute -top-[9px] start-full ms-[6px] whitespace-nowrap rounded-[5px] bg-room-amber-bg px-[6px] py-px text-[10.5px] font-[650] not-italic leading-[15px] text-room-amber-ink tabular-nums">
              {fmt.dur(view.cut - r.last)}
            </em>
          </span>
        )}
        {view.live && r.events.length === 0 && r.seenTodayMin !== null && (
          <span className="absolute top-[24px] -ms-[4px] h-[9px] w-[9px] rounded-full border-2 border-room-ink-3 bg-white" style={at(r.seenTodayMin)} />
        )}
        {view.live && <span className="absolute -bottom-[11px] top-0 z-[1] w-0 border-s border-ink-primary" style={at(view.cut)} />}
      </div>
      <div className="relative mt-[2px] h-[16px]" aria-hidden="true">
        {axis.map((h) => (
          <span key={h} className="absolute top-0 -ms-[10px] w-[20px] text-center text-[11px] text-room-ink-3 tabular-nums" style={at(h * 60)}>
            {String(h).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}
