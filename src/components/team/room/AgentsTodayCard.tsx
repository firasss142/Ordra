"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ban } from "lucide-react";
import type { AgentDayRow, DayView } from "@/lib/team/room/day-view";
import type { MarketCode } from "@/lib/markets";
import { Avatar, HATCH_SMALL_STYLE, HATCH_STYLE, RoomCard, Swatch, WhatsAppButton, type Presence } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

const COLS = "grid-cols-[minmax(200px,236px)_minmax(240px,1fr)_78px_82px_74px_82px_96px_48px]";

type T = ReturnType<typeof useTranslations<"team.room.agents">>;

/** The line under her name: what she is doing, in words. Shared with the panel header. */
export function stateLine(r: AgentDayRow, t: T, fmt: RoomFormat): string {
  switch (r.state) {
    case "working":
      return t("st.working", { d: fmt.dur(r.sinceLastMin ?? 0) });
    case "idle":
      return t("st.idle", { d: fmt.dur(r.sinceLastMin ?? 0) });
    case "early":
      return t("st.early", { t: fmt.hm(r.last ?? 0), e: fmt.hm(r.shift?.[1] ?? 0) });
    case "left":
      return t("st.left", { t: fmt.hm(r.last ?? 0) });
    case "rest":
      return r.seenTodayMin !== null ? t("st.restSeen", { t: fmt.hm(r.seenTodayMin) }) : t("st.rest");
    case "late":
      return t("st.late", { t: fmt.hm(r.shift?.[0] ?? 0) });
    case "before":
      return t("st.before", { t: fmt.hm(r.shift?.[0] ?? 0) });
    case "done":
      return t("st.done", { a: fmt.hm(r.first ?? 0), b: fmt.hm(r.last ?? 0) });
    default:
      return t("st.absent");
  }
}

export function presenceOf(r: AgentDayRow, live: boolean): Presence {
  if (!live) return null;
  return r.state === "working" || r.state === "idle" || r.state === "late" ? r.state : "off";
}

const STATE_TONE: Partial<Record<AgentDayRow["state"], string>> = {
  working: "text-room-ink-2",
  idle: "font-medium text-room-amber-ink",
  late: "font-medium text-room-amber-ink",
  early: "font-medium text-room-amber-ink",
};

function DoneLeftBar({ r, live, max, h }: { r: AgentDayRow; live: boolean; max: number; h: number }) {
  const t = useTranslations("team.room.agents");
  const q = r.queue;
  const segs: [string, number, CSSProperties | undefined][] = [
    ["bg-room-teal", r.up, undefined],
    ["bg-room-red", r.rej, undefined],
  ];
  if (live) segs.push(["bg-room-prog", q.prog, undefined], ["bg-room-todo", q.toCall - q.unc, undefined], ["", q.unc, HATCH_STYLE]);
  const total = segs.reduce((s, [, n]) => s + n, 0);
  const width = total ? Math.max(6, (total / Math.max(1, max)) * 100) : 6;
  const b = (c: ReactNode) => <b className="font-semibold text-room-ink-2">{c}</b>;

  return (
    <>
      <div className="flex h-[12px] gap-[2px]" style={{ width: `${width}%` }}>
        {total ? (
          segs
            .filter(([, n]) => n > 0)
            .map(([cls, n, style], i) => <span key={i} className={`block h-full min-w-[3px] rounded-[4px] ${cls}`} style={{ flex: n, ...style }} />)
        ) : (
          <span className="block h-full flex-1 rounded-[4px] bg-room-todo" />
        )}
      </div>
      <div className="mt-[5px] flex gap-[10px] overflow-hidden whitespace-nowrap text-[11px] text-room-ink-3 tabular-nums">
        <span>{t.rich("capDone", { u: r.up, r: r.rej, b })}</span>
        {live && <span>{q.prog + q.toCall ? t.rich("capLeft", { p: q.prog, t: q.toCall, b }) : t("capNone")}</span>}
        {live && q.unc > 0 && <span className="font-semibold text-room-red">{t("capUnc", { n: q.unc, h })}</span>}
      </div>
    </>
  );
}

function Val({ n, bad = false }: { n: number; bad?: boolean }) {
  return <span className={`text-[15px] tabular-nums ${n ? (bad ? "font-semibold text-room-red" : "font-semibold") : "font-medium text-room-ink-4"}`}>{n}</span>;
}

interface Props {
  view: DayView;
  fmt: RoomFormat;
  market: MarketCode;
  selected: string | null;
  onSelect: (agentId: string) => void;
}

/** Who is working and what each one has done and still holds. prototypes/team-v5.html `renderAgents()` */
export function AgentsTodayCard({ view, fmt, market, selected, onSelect }: Props) {
  const t = useTranslations("team.room.agents");
  const live = view.live;
  const h = view.callMin / 60;
  const tot = (r: AgentDayRow) => r.up + r.rej + (live ? r.queue.prog + r.queue.toCall : 0);
  const max = Math.max(1, ...view.rows.map(tot));
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <RoomCard>
      <div className="flex flex-wrap items-center gap-[12px] px-[18px] pb-[13px] pt-[15px]">
        <h3 className="text-[15.5px] font-[620] text-ink-primary">{t("title")}</h3>
        <span className="text-[12.5px] text-room-ink-3">{live ? t("hint") : t("hintPast")}</span>
        <div className="ms-auto flex flex-wrap items-center gap-[14px] text-[12px] text-room-ink-2 max-[900px]:ms-0">
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-teal" />{t("lgU")}</span>
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-red" />{t("lgR")}</span>
          {live && (
            <>
              <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-prog" />{t("lgP")}</span>
              <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-todo" />{t("lgT")}</span>
              <span className="inline-flex items-center gap-[6px]"><i className="inline-block h-[10px] w-[10px] rounded-[3px]" style={HATCH_SMALL_STYLE} aria-hidden="true" />{t("lgO", { h })}</span>
            </>
          )}
        </div>
      </div>

      <div role="table" aria-label={t("title")}>
        <div role="row" className={`grid ${COLS} items-center border-y border-line-subtle bg-surface-sunken max-[900px]:hidden`}>
          {[t("cAgent"), t("cBar"), t("cAssigned"), t("cUploaded"), t("cRejected"), t("cAttempts"), live ? t("cUnc", { h }) : t("cUncPast", { h }), ""].map((label, i) => (
            <div key={i} role="columnheader" className={`whitespace-nowrap px-[10px] py-[8px] text-[12px] font-medium text-room-ink-2 first:ps-[18px] last:pe-[14px] ${i >= 2 ? "text-end" : ""}`}>
              {label}
            </div>
          ))}
        </div>

        {view.rows.length === 0 && <div className="px-[18px] py-[16px] text-[13px] text-room-ink-3">{t("empty")}</div>}

        {view.rows.map((r) => {
          const sel = selected === r.agentId;
          const cells: [string, number, boolean][] = [
            [t("phAssigned"), r.assigned, false],
            [t("phUploaded"), r.up, false],
            [t("phRejected"), r.rej, false],
            [t("phAttempts"), r.att, false],
            [`> ${h} ${t("hShort")}`, r.uncN, true],
          ];
          return (
            <div
              key={r.agentId}
              role="row"
              tabIndex={0}
              aria-selected={sel}
              onClick={() => onSelect(r.agentId)}
              onKeyDown={(e) => onKey(e, r.agentId)}
              className={`grid ${COLS} cursor-pointer items-center border-b border-room-line-faint transition-colors duration-[120ms] last:border-b-0 hover:bg-room-hover max-[900px]:grid-cols-[1fr_auto] max-[900px]:gap-x-[8px] max-[900px]:gap-y-[10px] max-[900px]:px-[16px] max-[900px]:py-[14px] max-[900px]:[grid-template-areas:'who_wa'_'bar_bar'_'cells_cells'] ${sel ? "bg-brand-tint shadow-[inset_3px_0_0_var(--brand)] rtl:shadow-[inset_-3px_0_0_var(--brand)]" : ""}`}
            >
              <div role="cell" className="min-w-0 py-[12px] pe-[10px] ps-[18px] max-[900px]:p-0 max-[900px]:[grid-area:who]">
                <div className="flex min-w-0 items-center gap-[11px]">
                  <Avatar name={r.name} presence={presenceOf(r, live)} />
                  <div className="min-w-0">
                    <b className="block text-[14px] font-semibold leading-[1.25] text-ink-primary">{r.name}</b>
                    <span className={`mt-px block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] ${STATE_TONE[r.state] ?? "text-room-ink-3"}`}>{stateLine(r, t, fmt)}</span>
                    {r.queue.cf > 0 && (
                      <span className="mt-[4px] inline-flex items-center gap-[4px] whitespace-nowrap rounded-[6px] bg-room-amber-bg px-[7px] py-px text-[11px] font-semibold text-room-amber-ink">
                        {t("tagCf", { n: r.queue.cf })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div role="cell" className="px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:bar]">
                <DoneLeftBar r={r} live={live} max={max} h={h} />
              </div>
              {cells.map(([, n, bad], i) => (
                <div key={i} role="cell" className="px-[10px] py-[12px] text-end max-[900px]:hidden">
                  <Val n={n} bad={bad} />
                </div>
              ))}
              <div className="hidden gap-[6px] [grid-area:cells] max-[900px]:grid max-[900px]:grid-cols-5">
                {cells.map(([label, n, bad], i) => (
                  <div key={i} className="rounded-[9px] bg-surface-sunken px-[8px] py-[7px] text-center">
                    <small className="block overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-room-ink-3">{label}</small>
                    <b className={`block text-[15px] font-[650] tabular-nums ${bad && n ? "text-room-red" : ""}`}>{n}</b>
                  </div>
                ))}
              </div>
              <div role="cell" className="py-[12px] pe-[14px] ps-[10px] text-end max-[900px]:p-0 max-[900px]:[grid-area:wa]">
                <WhatsAppButton phone={r.phone} market={market} />
              </div>
            </div>
          );
        })}
      </div>

      {view.dormant.length > 0 && (
        <div className="flex flex-wrap items-center gap-[10px] border-t border-line-subtle px-[18px] py-[11px] text-[12.5px] text-room-ink-2">
          <Ban size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{t("dormant", { n: view.dormant.length })}</span>
          <span className="inline-flex flex-wrap gap-[6px]">
            {view.dormant.map((d) => (
              <button
                key={d.agentId}
                type="button"
                onClick={() => onSelect(d.agentId)}
                className="inline-flex h-[24px] items-center gap-[5px] rounded-full border border-line-subtle bg-surface-sunken pe-[9px] ps-[3px] font-medium text-ink-primary"
              >
                <Avatar name={d.name} size={18} />
                {d.name}
                {d.cf > 0 && <span className="font-semibold text-room-amber-ink"> · {t("tagCf", { n: d.cf })}</span>}
              </button>
            ))}
          </span>
        </div>
      )}
    </RoomCard>
  );
}
