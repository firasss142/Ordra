"use client";

/**
 * The three pieces above the list (prototype v4/v5): the « À faire » button in
 * the header, one slim tile per bucket, one slim card per agent. Details live
 * in tooltips so the list starts on the first screen.
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Bell, Check, ChevronDown, Clock, Moon, Phone, PhoneOff, Truck, Undo2, UserX } from "lucide-react";
import type { AgentBoard } from "@/lib/delivery/board";
import type { BucketTile, LiveBucket, TodoLine } from "@/lib/delivery/manager";
import { Money, useDuration } from "../ui";
import { Ring, agentVars, sitDot, useDismiss } from "./parts";

export interface AgentCard extends AgentBoard {
  color: string | null;
  ring: { treated: number; total: number };
}

export function TodoButton({ lines, liveCount, toTreat, open, onOpen, onSeeLate, onSeeStalled, onReassignAgent, onAssignNone }: {
  lines: TodoLine[]; liveCount: number; toTreat: number; open: boolean; onOpen: (v: boolean) => void;
  onSeeLate: () => void; onSeeStalled: () => void; onReassignAgent: (id: string) => void; onAssignNone: (ids: string[]) => void;
}) {
  const t = useTranslations("delivery.manager.todo");
  const ref = useDismiss(open, () => onOpen(false));
  if (liveCount === 0) return null;
  if (!lines.some((l) => l.kind !== "stall")) {
    return <span className="todob ok" data-tip={t("calmTip", { n: toTreat })}><Check className="ic" />{t("calm")}</span>;
  }
  const hl = (c: ReactNode) => <span className="n">{c}</span>;
  return (
    <span className="todow" ref={ref}>
      <button type="button" className={`todob${open ? " open" : ""}`} aria-expanded={open} onClick={() => onOpen(!open)}>
        <Bell className="ic" />{t("label")}<i>{lines.length}</i><ChevronDown className="ic chev" />
      </button>
      {open ? (
        <div className="tpanel" role="region" aria-label={t("label")}>
          {lines.map((x) => {
            switch (x.kind) {
              case "late":
                return (
                  <div key="late" className="tline bad"><span className="ti"><Clock className="ic" /></span>
                    <div className="tt"><b>{t.rich("late", { n: x.n, hl })}</b><p>{x.by.map((a) => `${a.name} (${a.n})`).join(" · ")}</p></div>
                    <button type="button" className="btn sec sm" onClick={onSeeLate}>{t("see")}</button></div>
                );
              case "idle":
                return (
                  <div key={`idle-${x.id}`} className="tline warn"><span className="ti"><Moon className="ic" /></span>
                    <div className="tt"><b>{t.rich("idle", { name: x.name, n: x.toTreat, hl })}</b><p>{t("idleSub")}</p></div>
                    <button type="button" className="btn pri sm" onClick={() => onReassignAgent(x.id)}>{t("reassignAll", { n: x.inFlight })}</button></div>
                );
              case "none":
                return (
                  <div key="none" className="tline warn"><span className="ti"><UserX className="ic" /></span>
                    <div className="tt"><b>{t.rich("none", { n: x.ids.length, hl })}</b><p>{t("noneSub")}</p></div>
                    <button type="button" className="btn pri sm" onClick={() => onAssignNone(x.ids)}>{t("assign")}</button></div>
                );
              case "courier":
                return (
                  <div key={`c-${x.name}`} className="tline warn"><span className="ti"><PhoneOff className="ic" /></span>
                    <div className="tt"><b>{t.rich("courier", { name: x.name, n: x.n, hl })}</b><p>{t("courierSub")}</p></div>
                    {x.phone ? <a className="btn sec sm" href={`tel:${x.phone}`}><Phone className="ic" />{t("call")}</a> : null}</div>
                );
              default:
                return (
                  <div key="stall" className="tline flat"><span className="ti"><Moon className="ic" /></span>
                    <div className="tt"><b>{t.rich("stall", { n: x.n, hl })}</b><p>{t("stallSub")}</p></div>
                    <button type="button" className="btn sec sm" onClick={onSeeStalled}>{t("see")}</button></div>
                );
            }
          })}
        </div>
      ) : null}
    </span>
  );
}

const BK_ICON: Record<LiveBucket, typeof Undo2> = { returning: Undo2, act_now: AlertCircle, waiting_customer: Clock, waiting_carrier: Truck };

export function BucketStrip({ tiles, selected, targetHours, market, locale, onToggle }: {
  tiles: BucketTile[]; selected: LiveBucket[]; targetHours: number; market: "ly" | "tn"; locale: string; onToggle: (b: LiveBucket) => void;
}) {
  const t = useTranslations("delivery.manager");
  const tSit = useTranslations("delivery.sit");
  return (
    <section className="bks2" aria-label={t("buckets.title")}>
      {tiles.map((x) => {
        const on = selected.includes(x.bucket);
        const Icon = BK_ICON[x.bucket];
        const tip = [t(`rules.${x.bucket}`), ...x.segments.map((s) => `${s.count} ${tSit(s.key)}`)].join(" · ");
        return (
          <button key={x.bucket} type="button" className={`card bk2${on ? " on" : ""}${selected.length && !on ? " dim" : ""}`} aria-pressed={on} data-tip={tip} onClick={() => onToggle(x.bucket)}>
            <div className="r1"><span className="si"><Icon className="ic" /></span><span className="nm">{t(`buckets.${x.bucket}`)}</span>{on ? <span className="tag good">{t("filterTag")}</span> : null}</div>
            <div className="r2">
              <b className={`num${x.count ? "" : " zero"}`}>{x.count}</b><span>{t("parcels")}</span>
              {x.late ? <span className="tag warn" data-tip={t("lateTip", { n: x.late, h: targetHours })}><Clock className="ic" />{t("lateN", { n: x.late })}</span> : null}
              <em><Money amount={x.amount} market={market} locale={locale} /></em>
            </div>
            <div className="bar">{x.segments.map((s) => <i key={s.key} style={{ width: `${(s.count / x.count) * 100}%`, background: sitDot(s.key) }} />)}</div>
          </button>
        );
      })}
    </section>
  );
}

const VDOT = { late: "var(--warn-dot)", idle: "var(--ink-4)", ok: "var(--live)" } as const;

/** One row of cards: past this many, the rest wait behind « +N » so the list stays on the first screen. */
export const TEAM_ROW = 6;

export function TeamStrip({ cards, selected, onToggle }: { cards: AgentCard[]; selected: string[]; onToggle: (id: string) => void }) {
  const t = useTranslations("delivery.manager");
  const duration = useDuration();
  const [expanded, setExpanded] = useState(false);
  if (cards.length === 0) return null;
  const overflow = cards.length > TEAM_ROW;
  // A filtered agent never hides behind « +N ».
  const all = expanded || cards.slice(TEAM_ROW).some((c) => selected.includes(c.id));
  const shown = overflow && !all ? cards.slice(0, TEAM_ROW) : cards;
  return (
    <section className={`ags2${overflow ? " more" : ""}`} aria-label={t("team")}>
      {shown.map((b) => {
        const on = selected.includes(b.id);
        const flag = b.verdict === "late" ? t("flagLate", { n: b.lateCount, age: duration(b.oldestHours) }) : b.verdict === "idle" ? t("flagIdle") : t("verdict.ok");
        const tip = [flag, t("ring", b.ring), t("inFlight", { n: b.inFlight })].join(" · ");
        return (
          <button key={b.id} type="button" className={`ag2${on ? " on" : ""}${selected.length && !on ? " dim" : ""}`} style={agentVars(b.id, b.color)}
            aria-pressed={on} data-tip={tip} onClick={() => onToggle(b.id)}>
            <Ring treated={b.ring.treated} total={b.ring.total} />
            <span className="tx">
              <span className="nm">{b.name}</span>
              <span className="st"><i className="d" style={{ background: VDOT[b.verdict] }} />
                <span className={`v${b.verdict === "late" ? " warn" : ""}`}>{b.verdict === "late" ? t("lateN", { n: b.lateCount }) : t(`verdict.${b.verdict}`)}</span></span>
              <span className="wk">{t.rich("weekLine", { saved: b.savedWeek, lost: b.lostWeek, b: (c) => <b>{c}</b> })}</span>
            </span>
          </button>
        );
      })}
      {overflow ? (
        <button type="button" className="agmore" aria-expanded={all} onClick={() => setExpanded(!all)}>
          {all ? t("teamLess") : t("teamMore", { n: cards.length - TEAM_ROW })}
        </button>
      ) : null}
    </section>
  );
}
