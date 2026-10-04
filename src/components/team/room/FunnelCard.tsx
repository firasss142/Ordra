"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Wallet } from "lucide-react";
import type { FunnelRow, FunnelView } from "@/lib/team/room/funnel-view";
import { MIN_SCORED } from "@/lib/team/room/funnel-view";
import { MAX_RANGE_DAYS, recentMonths, type FunnelPeriod } from "@/lib/team/room/period";
import { addDays, daysBetween } from "@/lib/team/room/time";
import { Avatar, Swatch, agentStyle } from "./parts";
import type { RoomFormat } from "./useRoomFormat";

export interface BalanceInfo {
  balance: number;
  lastPaidAt: string | null;
}

/** [30 derniers jours | Mois | Dates] — the owner's addition (2026-10-03), kept in v6 (2026-10-04). */
export function PeriodControl({ period, today, fmt, onChange }: { period: FunnelPeriod; today: string; fmt: RoomFormat; onChange: (p: FunnelPeriod) => void }) {
  const t = useTranslations("team.room.period");
  const months = recentMonths(today, 12);
  const [from, setFrom] = useState(period.kind === "range" ? period.from : addDays(today, -13));
  const [to, setTo] = useState(period.kind === "range" ? period.to : today);
  const rangeOk = from <= to && to <= today && daysBetween(from, to) + 1 <= MAX_RANGE_DAYS;
  const on = (b: boolean) => (b ? "r6-on" : "");

  return (
    <div className="r6-pctl2">
      <div className="r6-seg" role="tablist" aria-label={t("label")}>
        <button type="button" role="tab" aria-selected={period.kind === "rolling30"} className={on(period.kind === "rolling30")} onClick={() => onChange({ kind: "rolling30" })}>
          {t("rolling")}
        </button>
        <button type="button" role="tab" aria-selected={period.kind === "month"} className={on(period.kind === "month")} onClick={() => onChange({ kind: "month", month: period.kind === "month" ? period.month : months[1] })}>
          {t("month")}
        </button>
        <button type="button" role="tab" aria-selected={period.kind === "range"} className={on(period.kind === "range")} onClick={() => rangeOk && onChange({ kind: "range", from, to })}>
          {t("custom")}
        </button>
      </div>
      {period.kind === "month" && (
        <select aria-label={t("month")} value={period.month} onChange={(e) => onChange({ kind: "month", month: e.target.value })} style={{ textTransform: "capitalize" }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {fmt.month(m)}
            </option>
          ))}
        </select>
      )}
      {period.kind === "range" && (
        <>
          <input type="date" aria-label={t("from")} value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          <span aria-hidden="true">→</span>
          <input type="date" aria-label={t("to")} value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="r6-btn r6-pri r6-sm" disabled={!rangeOk || (period.from === from && period.to === to)} onClick={() => onChange({ kind: "range", from, to })}>
            {t("apply")}
          </button>
          {!rangeOk && <span className="r6-err">{t("invalid", { n: MAX_RANGE_DAYS })}</span>}
        </>
      )}
    </div>
  );
}

function Trend({ v, tip }: { v: number | null; tip: string }) {
  if (v === null) return null;
  const label = `${v > 0 ? "+" : v < 0 ? "−" : "="}${v ? Math.abs(v) : ""} · ${tip}`;
  if (v === 0)
    return (
      <span className="r6-tr r6-eq" data-tip={tip} aria-label={label}>
        =
      </span>
    );
  return (
    <span className={`r6-tr ${v > 0 ? "r6-good" : "r6-bad"}`} data-tip={tip} aria-label={label}>
      {v > 0 ? <ArrowUp className="r6-ic" aria-hidden="true" /> : <ArrowDown className="r6-ic" aria-hidden="true" />}
      {Math.abs(v)}
    </span>
  );
}

type Counts = { assigned: number; delivered: number; enRoute: number; returned: number; notUploaded: number };

function FunnelBar({ r, max }: { r: Counts; max: number }) {
  const segs: [string, number][] = [
    ["del", r.delivered],
    ["road", r.enRoute],
    ["ret", r.returned],
    ["x", r.notUploaded],
  ];
  return (
    <div className="r6-fbar" style={{ width: `${max ? Math.max(4, (r.assigned / max) * 100) : 0}%` }}>
      {segs
        .filter(([, n]) => n > 0)
        .map(([k, n]) => (
          <span key={k} className={`r6-k-${k}`} style={{ flex: n }} />
        ))}
    </div>
  );
}

function Score({ score, trend, tip }: { score: number | null; trend: number | null; tip: string }) {
  return (
    <div className="r6-score">
      <div className="r6-sv">
        <b>{score === null ? "—" : Math.round(score)}</b>
        <small>/100</small>
      </div>
      <Trend v={trend} tip={tip} />
    </div>
  );
}

interface Props {
  view: FunnelView;
  period: FunnelPeriod;
  today: string;
  fmt: RoomFormat;
  title: string;
  meta: string;
  due: number | null;
  balances: Record<string, BalanceInfo>;
  canPay: boolean;
  selected: string | null;
  onPeriod: (p: FunnelPeriod) => void;
  onSelect: (agentId: string) => void;
  onPay: (agentId: string) => void;
}

/** 3 · Assigned → uploaded → delivered, ranked — v5's table, redrawn. prototypes/team-v6.html `table30()` */
export function FunnelCard({ view, period, today, fmt, title, meta, due, balances, canPay, selected, onPeriod, onSelect, onPay }: Props) {
  const t = useTranslations("team.room.funnel");
  const tb = useTranslations("team.room.band");
  const tm = view.team;
  const prevLabel = period.kind === "month" ? fmt.month(view.prevFrom.slice(0, 7)) : `${fmt.dayNum(view.prevFrom)} → ${fmt.dayNum(view.prevTo)}`;
  const trendTip = (prev: number | null) => (prev === null ? t("trendNone", { p: prevLabel }) : t("trendTitle", { p: prevLabel, v: Math.round(prev) }));
  const head = (label: ReactNode, sub?: ReactNode, end = false) => (
    <div role="columnheader" className={end ? "r6-n" : ""}>
      {label}
      {sub && <small>{sub}</small>}
    </div>
  );
  const nums = (a: number, u: number, d: number) => (
    <div className="r6-c-nums">
      <span>{t("cAssigned")} <b>{fmt.num(a)}</b></span>
      <span>{t("cUploaded")} <b>{fmt.num(u)}</b></span>
      <span>{t("cDelivered")} <b>{fmt.num(d)}</b></span>
    </div>
  );

  return (
    <section>
      <div className="r6-sec-h">
        <div>
          <h2>{title}</h2>
          <div className="r6-meta">{meta}</div>
        </div>
        <div style={{ marginInlineStart: "auto" }}>
          <PeriodControl key={JSON.stringify(period)} period={period} today={today} fmt={fmt} onChange={onPeriod} />
        </div>
        {due !== null && (
          <div className="r6-due" style={{ marginInlineStart: 0 }}>
            <span className="r6-di"><Wallet className="r6-ic" aria-hidden="true" /></span>
            <span>{tb("due")}</span>
            <b>{fmt.money(due)}</b>
          </div>
        )}
      </div>

      <div className="r6-card r6-ft">
        <div className="r6-fh">
          <h3>{t("title")}</h3>
          <div className="r6-legend">
            <span><Swatch k="del" />{t("fD")}</span>
            <span><Swatch k="road" />{t("fE")}</span>
            <span><Swatch k="ret" />{t("fF")}</span>
            <span><Swatch k="x" />{t("fX")}</span>
          </div>
        </div>

        <div role="table" aria-label={t("title")}>
          <div role="row" className="r6-hdr">
            {head(t("cRank"))}
            {head(t("cAgent"))}
            {head("")}
            {head(t("cAssigned"), undefined, true)}
            {head(t("cUploaded"), t("cUploadedSub"), true)}
            {head(t("cDelivered"), t("cDeliveredSub"), true)}
            {head(t("cScore"), period.kind === "month" ? t("cScoreSubMonth") : t("cScoreSub"), true)}
            {head(t("cBalance"), undefined, true)}
          </div>

          {/* the team — the yardstick every agent is read against */}
          <div role="row" className="r6-row r6-team">
            <div role="cell" className="r6-c-rk" />
            <div role="cell" className="r6-c-who">
              <div className="r6-who">
                <span className="r6-av r6-sigma" aria-hidden="true">Σ</span>
                <div className="r6-nm"><b>{t("team")}</b></div>
              </div>
            </div>
            <div role="cell" className="r6-c-bar"><FunnelBar r={tm} max={tm.assigned} /></div>
            <div role="cell" className="r6-n r6-c-num"><span className="r6-val">{fmt.num(tm.assigned)}</span></div>
            <div role="cell" className="r6-n r6-c-num"><span className="r6-val">{fmt.num(tm.uploaded)}</span><span className="r6-sub2">{fmt.pct(tm.upl)}</span></div>
            <div role="cell" className="r6-n r6-c-num"><span className="r6-val">{fmt.num(tm.delivered)}</span><span className="r6-sub2">{fmt.pct(tm.dlv)}</span></div>
            {nums(tm.assigned, tm.uploaded, tm.delivered)}
            <div role="cell" className="r6-n r6-c-score"><Score score={tm.score} trend={tm.trend} tip={trendTip(tm.prevScore)} /></div>
            <div role="cell" className="r6-c-bal" />
          </div>

          {view.rows.map((r) => (
            <Row key={r.agentId} r={r} max={view.max} fmt={fmt} bal={balances[r.agentId]} canPay={canPay} sel={selected === r.agentId} tip={trendTip(r.prevScore)} onSelect={onSelect} onPay={onPay} nums={nums(r.assigned, r.uploaded, r.delivered)} />
          ))}
        </div>

        <div className="r6-cfoot">
          <span>{t("foot")}</span>
          <span>{t("footScore", { n: MIN_SCORED })}</span>
        </div>
      </div>
    </section>
  );
}

function Row({ r, max, fmt, bal, canPay, sel, tip, onSelect, onPay, nums }: {
  r: FunnelRow;
  max: number;
  fmt: RoomFormat;
  bal: BalanceInfo | undefined;
  canPay: boolean;
  sel: boolean;
  tip: string;
  onSelect: (id: string) => void;
  onPay: (id: string) => void;
  nums: ReactNode;
}) {
  const t = useTranslations("team.room.funnel");
  const b = (c: ReactNode) => <b>{c}</b>;
  const balance = bal?.balance ?? r.balance;
  const line = !r.assigned ? t("none") : !r.scored ? t("held") : r.inactiveSince ? t("inactive", { d: fmt.dayNum(r.inactiveSince) }) : "";
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(r.agentId);
    }
  };
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={sel}
      onClick={() => onSelect(r.agentId)}
      onKeyDown={onKey}
      className={`r6-row ${r.scored ? "" : "r6-dimr"} ${sel ? "r6-sel" : ""}`}
      style={agentStyle(r.color, r.agentId)}
    >
      <div role="cell" className="r6-c-rk">
        {r.rank !== null && <span className={`r6-medal r6-m${Math.min(r.rank, 4)}`}>{r.rank}</span>}
      </div>
      <div role="cell" className="r6-c-who">
        <div className="r6-who">
          <Avatar name={r.name} agentId={r.agentId} color={r.color} />
          <div className="r6-nm">
            <b>{r.name}</b>
            {line && <span className="r6-st">{line}</span>}
            {(r.weakUpl || r.weakDlv) && (
              <div className="r6-tags">
                {r.weakUpl && <span className="r6-tagw">{t("weakUpl")}</span>}
                {r.weakDlv && <span className="r6-tagw">{t("weakDlv")}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
      <div role="cell" className="r6-c-bar">
        {r.assigned > 0 && (
          <>
            <FunnelBar r={r} max={max} />
            <div className="r6-fcap">
              <span>{t.rich("capD", { n: r.delivered, b })}</span>
              <span>{t.rich("capE", { n: r.enRoute, b })}</span>
              <span>{t.rich("capF", { n: r.returned, b })}</span>
            </div>
          </>
        )}
      </div>
      <div role="cell" className="r6-n r6-c-num">
        <span className={`r6-val ${r.assigned ? "" : "r6-dim"}`}>{fmt.num(r.assigned)}</span>
      </div>
      <div role="cell" className="r6-n r6-c-num">
        <span className="r6-val">{fmt.num(r.uploaded)}</span>
        {r.assigned > 0 && <span className="r6-sub2">{fmt.pct(r.upl)}</span>}
      </div>
      <div role="cell" className="r6-n r6-c-num">
        <span className="r6-val">{fmt.num(r.delivered)}</span>
        {r.delivered + r.returned > 0 && <span className="r6-sub2">{fmt.pct(r.dlv)}</span>}
      </div>
      {nums}
      <div role="cell" className="r6-n r6-c-score">
        {r.scored ? <Score score={r.score} trend={r.trend} tip={tip} /> : <span className="r6-val r6-dim">—</span>}
      </div>
      <div role="cell" className="r6-n r6-c-bal">
        <div className="r6-balc">
          <div className="r6-bal">
            <b>{fmt.money(balance)}</b>
            <small>{bal?.lastPaidAt ? t("lastPaid", { d: fmt.dayNum(bal.lastPaidAt) }) : t("neverPaid")}</small>
          </div>
          {canPay && balance > 0 && (
            <button
              type="button"
              className="r6-btn r6-sm"
              onClick={(e) => {
                e.stopPropagation();
                onPay(r.agentId);
              }}
            >
              {t("pay")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
