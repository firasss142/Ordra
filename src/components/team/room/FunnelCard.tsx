"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { FunnelRow, FunnelView } from "@/lib/team/room/funnel-view";
import { MIN_SCORED } from "@/lib/team/room/funnel-view";
import { MAX_RANGE_DAYS, recentMonths, type FunnelPeriod } from "@/lib/team/room/period";
import { addDays, daysBetween } from "@/lib/team/room/time";
import { Avatar, RoomCard, Swatch } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

const COLS = "grid-cols-[40px_minmax(170px,210px)_minmax(220px,1fr)_80px_92px_100px_132px_172px]";
const PHONE_ROW =
  "max-[900px]:grid-cols-[auto_1fr_auto] max-[900px]:gap-[10px] max-[900px]:px-[16px] max-[900px]:py-[14px] max-[900px]:[grid-template-areas:'rk_who_score'_'bar_bar_bar'_'nums_nums_bal']";

export interface BalanceInfo {
  balance: number;
  lastPaidAt: string | null;
}

/** [30 derniers jours | Mois | Dates] — the owner's addition to the prototype (2026-10-03). */
export function PeriodControl({ period, today, fmt, onChange }: { period: FunnelPeriod; today: string; fmt: RoomFormat; onChange: (p: FunnelPeriod) => void }) {
  const t = useTranslations("team.room.period");
  const months = recentMonths(today, 12);
  const [from, setFrom] = useState(period.kind === "range" ? period.from : addDays(today, -13));
  const [to, setTo] = useState(period.kind === "range" ? period.to : today);
  const rangeOk = from <= to && to <= today && daysBetween(from, to) + 1 <= MAX_RANGE_DAYS;

  const seg = (on: boolean) =>
    `h-[28px] whitespace-nowrap rounded-[8px] px-[13px] text-[12.5px] ${on ? "bg-white font-semibold text-ink-primary shadow-[0_1px_2px_rgba(16,24,40,.08)]" : "font-medium text-room-ink-2 hover:text-ink-primary"}`;
  const input = "h-[32px] rounded-[9px] border border-line bg-surface-card px-[10px] text-[13px] tabular-nums text-ink-primary";

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <div role="tablist" aria-label={t("label")} className="inline-flex rounded-[10px] border border-line-subtle bg-surface-sunken p-[2px]">
        <button type="button" role="tab" aria-selected={period.kind === "rolling30"} className={seg(period.kind === "rolling30")} onClick={() => onChange({ kind: "rolling30" })}>
          {t("rolling")}
        </button>
        <button type="button" role="tab" aria-selected={period.kind === "month"} className={seg(period.kind === "month")} onClick={() => onChange({ kind: "month", month: period.kind === "month" ? period.month : months[1] })}>
          {t("month")}
        </button>
        <button type="button" role="tab" aria-selected={period.kind === "range"} className={seg(period.kind === "range")} onClick={() => rangeOk && onChange({ kind: "range", from, to })}>
          {t("custom")}
        </button>
      </div>
      {period.kind === "month" && (
        <select aria-label={t("month")} value={period.month} onChange={(e) => onChange({ kind: "month", month: e.target.value })} className={`${input} capitalize`}>
          {months.map((m) => (
            <option key={m} value={m}>
              {fmt.month(m)}
            </option>
          ))}
        </select>
      )}
      {period.kind === "range" && (
        <span className="inline-flex flex-wrap items-center gap-[6px] text-[12.5px] text-room-ink-2">
          <input type="date" aria-label={t("from")} value={from} max={today} onChange={(e) => setFrom(e.target.value)} className={input} />
          <span aria-hidden="true">→</span>
          <input type="date" aria-label={t("to")} value={to} max={today} onChange={(e) => setTo(e.target.value)} className={input} />
          <button
            type="button"
            disabled={!rangeOk || (period.from === from && period.to === to)}
            onClick={() => onChange({ kind: "range", from, to })}
            className="inline-flex h-[32px] items-center rounded-[9px] border border-brand bg-brand px-[12px] text-[13px] font-medium text-white hover:enabled:bg-brand-hover disabled:cursor-default disabled:opacity-40"
          >
            {t("apply")}
          </button>
          {!rangeOk && <span className="text-room-red">{t("invalid", { n: MAX_RANGE_DAYS })}</span>}
        </span>
      )}
    </div>
  );
}

function Trend({ v, title }: { v: number | null; title: string }) {
  if (v === null) return null;
  const tone = v > 0 ? "bg-room-green-bg text-room-green" : v < 0 ? "bg-room-red-bg text-room-red" : "bg-surface-sunken text-room-ink-3";
  return (
    <span title={title} className={`inline-flex h-[20px] items-center gap-[2px] whitespace-nowrap rounded-full px-[7px] text-[11.5px] font-[650] tabular-nums ${tone}`}>
      {v > 0 ? "▲" : v < 0 ? "▼" : "="} {Math.abs(v)}
    </span>
  );
}

function FunnelBar({ r, max }: { r: { assigned: number; delivered: number; enRoute: number; returned: number; notUploaded: number }; max: number }) {
  const segs: [string, number][] = [
    ["bg-room-green", r.delivered],
    ["bg-room-teal-soft", r.enRoute],
    ["bg-room-red-soft", r.returned],
    ["bg-[#E4E6E9]", r.notUploaded],
  ];
  return (
    <div className="flex h-[12px] gap-[2px]" style={{ width: `${max ? (r.assigned / max) * 100 : 0}%` }}>
      {segs.filter(([, n]) => n > 0).map(([cls, n], i) => (
        <span key={i} className={`block h-full rounded-[4px] ${cls}`} style={{ flex: n }} />
      ))}
    </div>
  );
}

function Score({ score, trend, title }: { score: number | null; trend: number | null; title: string }) {
  return (
    <div className="flex items-center justify-end gap-[8px]">
      <div className="flex items-baseline gap-[2px]">
        <b className="text-[23px] font-bold tracking-[-0.02em] tabular-nums">{score === null ? "—" : Math.round(score)}</b>
        <small className="text-[12px] text-room-ink-3">/100</small>
      </div>
      <Trend v={trend} title={title} />
    </div>
  );
}

interface Props {
  view: FunnelView;
  period: FunnelPeriod;
  fmt: RoomFormat;
  balances: Record<string, BalanceInfo>;
  canPay: boolean;
  selected: string | null;
  onSelect: (agentId: string) => void;
  onPay: (agentId: string) => void;
}

/** Assigned → uploaded → delivered, ranked. prototypes/team-v5.html `render30()` */
export function FunnelCard({ view, period, fmt, balances, canPay, selected, onSelect, onPay }: Props) {
  const t = useTranslations("team.room.funnel");
  const tm = view.team;
  const prevLabel = period.kind === "month" ? fmt.month(view.prevFrom.slice(0, 7)) : `${fmt.dayNum(view.prevFrom)} → ${fmt.dayNum(view.prevTo)}`;
  const trendTitle = (prev: number | null) => (prev === null ? t("trendNone", { p: prevLabel }) : t("trendTitle", { p: prevLabel, v: Math.round(prev) }));
  const scoreSub = period.kind === "month" ? t("cScoreSubMonth") : t("cScoreSub");
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };
  const head = (label: ReactNode, sub?: ReactNode, end = false) => (
    <div role="columnheader" className={`whitespace-nowrap px-[10px] py-[8px] text-[12px] font-medium text-room-ink-2 first:ps-[18px] last:pe-[18px] ${end ? "text-end" : ""}`}>
      {label}
      {sub && <small className="mt-px block text-[11px] font-normal text-room-ink-3">{sub}</small>}
    </div>
  );
  const nums = (a: number, u: number, d: number) => (
    <div className="hidden flex-wrap items-center gap-[12px] text-[12px] text-room-ink-3 tabular-nums [grid-area:nums] max-[900px]:flex">
      <span>{t("cAssigned")} <b className="font-semibold text-ink-primary">{fmt.num(a)}</b></span>·
      <span>{t("cUploaded")} <b className="font-semibold text-ink-primary">{fmt.num(u)}</b></span>·
      <span>{t("cDelivered")} <b className="font-semibold text-ink-primary">{fmt.num(d)}</b></span>
    </div>
  );

  return (
    <RoomCard>
      <div className="flex flex-wrap items-center gap-[12px] px-[18px] pb-[13px] pt-[15px]">
        <h3 className="text-[15.5px] font-[620] text-ink-primary">{t("title")}</h3>
        <div className="ms-auto flex flex-wrap items-center gap-[14px] text-[12px] text-room-ink-2 max-[900px]:ms-0">
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-green" />{t("fD")}</span>
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-teal-soft" />{t("fE")}</span>
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-room-red-soft" />{t("fF")}</span>
          <span className="inline-flex items-center gap-[6px]"><Swatch className="bg-[#E4E6E9]" />{t("fX")}</span>
        </div>
      </div>

      <div role="table" aria-label={t("title")}>
        <div role="row" className={`grid ${COLS} items-center border-y border-line-subtle bg-surface-sunken max-[900px]:hidden`}>
          {head(t("cRank"))}
          {head(t("cAgent"))}
          {head("")}
          {head(t("cAssigned"), undefined, true)}
          {head(t("cUploaded"), t("cUploadedSub"), true)}
          {head(t("cDelivered"), t("cDeliveredSub"), true)}
          {head(t("cScore"), scoreSub, true)}
          {head(t("cBalance"), undefined, true)}
        </div>

        {/* The team line — the yardstick every agent is read against. */}
        <div role="row" className={`grid ${COLS} items-center border-b border-line-subtle ${PHONE_ROW}`}>
          <div className="py-[12px] pe-[10px] ps-[18px] max-[900px]:p-0 max-[900px]:[grid-area:rk]" />
          <div className="px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:who]">
            <div className="flex items-center gap-[11px]">
              <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-ink-primary text-[13px] font-semibold text-white" aria-hidden="true">Σ</span>
              <b className="text-[14px] font-semibold">{t("team")}</b>
            </div>
          </div>
          <div className="px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:bar]">
            <FunnelBar r={tm} max={tm.assigned} />
          </div>
          <div className="px-[10px] py-[12px] text-end max-[900px]:hidden"><span className="text-[15px] font-semibold tabular-nums">{fmt.num(tm.assigned)}</span></div>
          <div className="px-[10px] py-[12px] text-end max-[900px]:hidden">
            <span className="text-[15px] font-semibold tabular-nums">{fmt.num(tm.uploaded)}</span>
            <span className="mt-px block whitespace-nowrap text-[11.5px] text-room-ink-3 tabular-nums">{fmt.pct(tm.upl)}</span>
          </div>
          <div className="px-[10px] py-[12px] text-end max-[900px]:hidden">
            <span className="text-[15px] font-semibold tabular-nums">{fmt.num(tm.delivered)}</span>
            <span className="mt-px block whitespace-nowrap text-[11.5px] text-room-ink-3 tabular-nums">{fmt.pct(tm.dlv)}</span>
          </div>
          {nums(tm.assigned, tm.uploaded, tm.delivered)}
          <div className="px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:score]">
            <Score score={tm.score} trend={tm.trend} title={trendTitle(tm.prevScore)} />
          </div>
          <div className="py-[12px] pe-[18px] ps-[10px] max-[900px]:p-0 max-[900px]:[grid-area:bal]" />
        </div>

        {view.rows.map((r) => (
          <Row
            key={r.agentId}
            r={r}
            max={view.max}
            fmt={fmt}
            bal={balances[r.agentId]}
            canPay={canPay}
            sel={selected === r.agentId}
            trendTitle={trendTitle(r.prevScore)}
            onSelect={onSelect}
            onKey={onKey}
            onPay={onPay}
            nums={nums(r.assigned, r.uploaded, r.delivered)}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-between gap-[10px] px-[18px] pb-[13px] pt-[11px] text-[11.5px] text-room-ink-3">
        <span>{t("foot")}</span>
        <span className="tabular-nums">{t("footScore", { n: MIN_SCORED })}</span>
      </div>
    </RoomCard>
  );
}

function Row({ r, max, fmt, bal, canPay, sel, trendTitle, onSelect, onKey, onPay, nums }: {
  r: FunnelRow;
  max: number;
  fmt: RoomFormat;
  bal: BalanceInfo | undefined;
  canPay: boolean;
  sel: boolean;
  trendTitle: string;
  onSelect: (id: string) => void;
  onKey: (e: KeyboardEvent, id: string) => void;
  onPay: (id: string) => void;
  nums: ReactNode;
}) {
  const t = useTranslations("team.room.funnel");
  const balance = bal?.balance ?? r.balance;
  const line = !r.assigned ? t("none") : !r.scored ? t("held") : r.inactiveSince ? t("inactive", { d: fmt.dayNum(r.inactiveSince) }) : "";
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={sel}
      onClick={() => onSelect(r.agentId)}
      onKeyDown={(e) => onKey(e, r.agentId)}
      className={`grid ${COLS} cursor-pointer items-center border-b border-room-line-faint hover:bg-room-hover ${PHONE_ROW} ${sel ? "bg-brand-tint" : ""} ${r.scored ? "" : "opacity-[.62]"}`}
    >
      <div role="cell" className="py-[12px] pe-[10px] ps-[18px] max-[900px]:p-0 max-[900px]:[grid-area:rk]">
        {r.rank !== null && (
          <span className={`inline-grid h-[24px] w-[24px] place-items-center rounded-full border text-[12px] font-[650] tabular-nums ${r.rank === 1 ? "border-ink-primary bg-ink-primary text-white" : "border-line-subtle bg-surface-sunken text-room-ink-2"}`}>
            {r.rank}
          </span>
        )}
      </div>
      <div role="cell" className="min-w-0 px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:who]">
        <div className="flex min-w-0 items-center gap-[11px]">
          <Avatar name={r.name} />
          <div className="min-w-0">
            <b className="block text-[14px] font-semibold leading-[1.25]">{r.name}</b>
            {line && <span className="mt-px block overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-room-ink-3">{line}</span>}
            {(r.weakUpl || r.weakDlv) && (
              <div className="flex flex-wrap gap-[4px]">
                {r.weakUpl && <span className="mt-[4px] inline-flex whitespace-nowrap rounded-[6px] bg-room-amber-bg px-[7px] py-px text-[11px] font-semibold text-room-amber-ink">{t("weakUpl")}</span>}
                {r.weakDlv && <span className="mt-[4px] inline-flex whitespace-nowrap rounded-[6px] bg-room-amber-bg px-[7px] py-px text-[11px] font-semibold text-room-amber-ink">{t("weakDlv")}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      <div role="cell" className="px-[10px] py-[12px] max-[900px]:p-0 max-[900px]:[grid-area:bar]">
        {r.assigned > 0 && (
          <>
            <FunnelBar r={r} max={max} />
            <div className="mt-[5px] flex gap-[10px] whitespace-nowrap text-[11px] text-room-ink-3 tabular-nums">
              <span>{t("capD", { n: r.delivered })}</span>
              <span>{t("capE", { n: r.enRoute })}</span>
              <span>{t("capF", { n: r.returned })}</span>
            </div>
          </>
        )}
      </div>
      <div role="cell" className="px-[10px] py-[12px] text-end max-[900px]:hidden">
        <span className={`text-[15px] tabular-nums ${r.assigned ? "font-semibold" : "font-medium text-room-ink-4"}`}>{fmt.num(r.assigned)}</span>
      </div>
      <div role="cell" className="px-[10px] py-[12px] text-end max-[900px]:hidden">
        <span className="text-[15px] font-semibold tabular-nums">{fmt.num(r.uploaded)}</span>
        {r.assigned > 0 && <span className="mt-px block whitespace-nowrap text-[11.5px] text-room-ink-3 tabular-nums">{fmt.pct(r.upl)}</span>}
      </div>
      <div role="cell" className="px-[10px] py-[12px] text-end max-[900px]:hidden">
        <span className="text-[15px] font-semibold tabular-nums">{fmt.num(r.delivered)}</span>
        {r.delivered + r.returned > 0 && <span className="mt-px block whitespace-nowrap text-[11.5px] text-room-ink-3 tabular-nums">{fmt.pct(r.dlv)}</span>}
      </div>
      {nums}
      <div role="cell" className="px-[10px] py-[12px] text-end max-[900px]:p-0 max-[900px]:[grid-area:score]">
        {r.scored ? <Score score={r.score} trend={r.trend} title={trendTitle} /> : <span className="text-[15px] font-medium text-room-ink-4">—</span>}
      </div>
      <div role="cell" className="py-[12px] pe-[18px] ps-[10px] max-[900px]:p-0 max-[900px]:[grid-area:bal]">
        <div className="flex items-center justify-end gap-[10px]">
          <div className="whitespace-nowrap text-end">
            <b className="block text-[14.5px] font-[650] tabular-nums">{fmt.money(balance)}</b>
            <small className="text-[11px] text-room-ink-3">{bal?.lastPaidAt ? t("lastPaid", { d: fmt.dayNum(bal.lastPaidAt) }) : t("neverPaid")}</small>
          </div>
          {canPay && balance > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPay(r.agentId);
              }}
              className="inline-flex h-[28px] items-center rounded-[8px] border border-line bg-surface-card px-[10px] text-[12.5px] font-medium hover:border-line-strong hover:bg-room-hover"
            >
              {t("pay")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
