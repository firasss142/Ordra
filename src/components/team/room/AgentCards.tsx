"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Ban, Check, Clock } from "lucide-react";
import type { AgentDayRow, DayView, DayWork } from "@/lib/team/room/day-view";
import type { MarketCode } from "@/lib/markets";
import { stateLine, presenceOf } from "./agent-state";
import { Avatar, Swatch, WhatsAppButton, agentStyle } from "./parts";
import { WORK } from "./TodayOverview";
import type { RoomFormat } from "./useRoomFormat";

const R = 66;
const C = 2 * Math.PI * R;
const GAP = 2.5;

/** Her ring: what she finished, then what she still holds, in the waffle's colours. */
function Ring({ seg, tipOf }: { seg: Partial<DayWork>; tipOf: (k: keyof DayWork, x: number) => string }) {
  const tot = WORK.reduce((s, k) => s + (seg[k] ?? 0), 0);
  let acc = 0;
  const arcs = WORK.flatMap((k) => {
    const x = seg[k] ?? 0;
    if (!x) return [];
    const len = (x / tot) * C;
    const whole = tot === x;
    const vis = whole ? C : Math.max(len - GAP, 1.2);
    const off = -acc - (whole ? 0 : GAP / 2);
    acc += len;
    return [
      <circle
        key={k}
        className={`r6-sg r6-k-${k}`}
        cx="84"
        cy="84"
        r={R}
        strokeDasharray={`${vis.toFixed(2)} ${(C + 10).toFixed(2)}`}
        strokeDashoffset={off.toFixed(2)}
        data-tip={tipOf(k, x)}
      />,
    ];
  });
  return (
    <svg className="r6-ringsvg" viewBox="0 0 168 168" aria-hidden="true">
      <circle className="r6-ringtrack" cx="84" cy="84" r={R} />
      <g className="r6-segs" transform="rotate(-90 84 84)">
        {arcs}
      </g>
    </svg>
  );
}

function Card({ r, view, fmt, market, n, selected, onSelect }: { r: AgentDayRow; view: DayView; fmt: RoomFormat; market: MarketCode; n: number; selected: boolean; onSelect: (id: string) => void }) {
  const t = useTranslations("team.room.cards");
  const ta = useTranslations("team.room.agents");
  const tov = useTranslations("team.room.ov");
  const live = view.live;
  const q = r.queue;
  const h = view.callMin / 60;
  const seg: Partial<DayWork> = live ? { up: r.up, rej: r.rej, prog: q.prog, todo: q.toCall - q.unc, late: q.unc } : { up: r.up, rej: r.rej };
  const done = r.up + r.rej;
  const hand = live ? q.prog + q.toCall : 0;
  const one = (k: keyof DayWork) => (k === "late" ? tov("one.late", { h }) : tov(`one.${k}`));
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(r.agentId);
    }
  };
  const line = stateLine(r, ta, fmt);

  let unc = null;
  if (live) {
    unc = q.unc ? (
      <div className="r6-unc r6-bad">
        <span className="r6-ui"><Clock className="r6-ic" aria-hidden="true" /></span>
        <div>
          <b>{t("uncBad", { n: q.unc, h })}</b>
          <small>{t("uncOld", { d: fmt.dur(q.uncOldestMin) })}</small>
        </div>
      </div>
    ) : (
      <div className="r6-unc">
        <span className="r6-ui"><Check className="r6-ic" aria-hidden="true" /></span>
        <div>
          <b>{t("uncOk")}</b>
          <small>{t("uncOkSub", { h })}</small>
        </div>
      </div>
    );
  } else if (r.rxTotal) {
    unc = r.uncN ? (
      <div className="r6-unc r6-bad">
        <span className="r6-ui"><Clock className="r6-ic" aria-hidden="true" /></span>
        <div>
          <b>{t("uncPast", { n: r.uncN, h })}</b>
          <small>{t("uncPastSub", { n: r.rxTotal })}</small>
        </div>
      </div>
    ) : (
      <div className="r6-unc">
        <span className="r6-ui"><Check className="r6-ic" aria-hidden="true" /></span>
        <div>
          <b>{t("uncPastOk", { h })}</b>
          <small>{t("uncPastSub", { n: r.rxTotal })}</small>
        </div>
      </div>
    );
  }

  const mini: [string, number][] = [
    [ta("cAssigned"), r.assigned],
    [ta("cUploaded"), r.up],
    [ta("cRejected"), r.rej],
    [ta("cAttempts"), r.att],
  ];

  return (
    <article
      className={`r6-ag ${selected ? "r6-on" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={r.name}
      aria-pressed={selected}
      onClick={() => onSelect(r.agentId)}
      onKeyDown={onKey}
      style={{ ...agentStyle(r.color, r.agentId), "--n": n } as CSSProperties}
    >
      <div className="r6-ag-h">
        <Avatar name={r.name} agentId={r.agentId} color={r.color} presence={presenceOf(r, live)} />
        <div className="r6-ag-n">
          <b>{r.name}</b>
          <span className={`r6-st r6-${r.state}`}>{line}</span>
          {q.cf > 0 && <span className="r6-tagw">{ta("tagCf", { n: q.cf })}</span>}
        </div>
        <WhatsAppButton phone={r.phone} market={market} />
      </div>
      <div className="r6-ag-ring">
        <Ring seg={seg} tipOf={(k, x) => t("tip", { k: one(k), n: x })} />
        <div className="r6-rc">
          <b>{done}</b>
          <div className="r6-l">{t("done")}</div>
          <div className="r6-h">{live ? t("hand", { n: hand }) : done ? t("rate", { p: fmt.pct((r.up / done) * 100) }) : ""}</div>
        </div>
      </div>
      <div className="r6-mini">
        {mini.map(([label, x]) => (
          <div key={label}>
            <small>{label}</small>
            <b className={x ? "" : "r6-z"}>{x}</b>
          </div>
        ))}
      </div>
      {unc}
    </article>
  );
}

interface Props {
  view: DayView;
  fmt: RoomFormat;
  market: MarketCode;
  selected: string | null;
  onSelect: (agentId: string) => void;
}

/** 2 · One live card per agent, in her colour. prototypes/team-v6.html `agentsToday()` */
export function AgentCards({ view, fmt, market, selected, onSelect }: Props) {
  const t = useTranslations("team.room.cards");
  const ta = useTranslations("team.room.agents");
  const live = view.live;
  const h = view.callMin / 60;
  const cols = Math.max(1, Math.min(4, view.rows.length));

  return (
    <section>
      <div className="r6-sec-h">
        <div>
          <h2>{live ? t("band") : t("bandPast")}</h2>
          <div className="r6-meta">{live ? t("meta") : t("metaPast")}</div>
        </div>
        <div className="r6-legend">
          <span><Swatch k="up" />{ta("lgU")}</span>
          <span><Swatch k="rej" />{ta("lgR")}</span>
          {live && (
            <>
              <span><Swatch k="prog" />{ta("lgP")}</span>
              <span><Swatch k="todo" />{ta("lgT")}</span>
              <span><Swatch k="late" />{ta("lgO", { h })}</span>
            </>
          )}
        </div>
      </div>

      {view.rows.length === 0 ? (
        <div className="r6-card" style={{ padding: "18px 20px" }}>
          <span className="r6-none">{ta("empty")}</span>
        </div>
      ) : (
        <div className="r6-cards" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}>
          {view.rows.map((r, i) => (
            <Card key={r.agentId} r={r} view={view} fmt={fmt} market={market} n={i} selected={selected === r.agentId} onSelect={onSelect} />
          ))}
        </div>
      )}

      {view.dormant.length > 0 && (
        <div className="r6-dorm">
          <Ban className="r6-ic" aria-hidden="true" />
          <span>{ta("dormant", { n: view.dormant.length })}</span>
          {view.dormant.map((d) => (
            <button key={d.agentId} type="button" className="r6-chipa" onClick={() => onSelect(d.agentId)}>
              <Avatar name={d.name} agentId={d.agentId} color={d.color} />
              {d.name}
              {d.cf > 0 && <span className="r6-tagw">{ta("tagCf", { n: d.cf })}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
