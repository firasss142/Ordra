"use client";

/**
 * One compact band of fixed height (owner, round 4): the month's answer on the
 * start side, « À faire » on the end side. Its details float over the page in
 * a panel and never push anything down.
 */
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Bell, Check, ChevronDown, Clock, Hourglass, PowerOff, UserX } from "lucide-react";
import type { DeskView } from "@/lib/prospects/desk/model";
import { fmtMoney, fmtNum, monthName, shiftMonth } from "./format";
import { useDismiss } from "./parts";

export function TopBand({ view, month, locale, marketId, onDistribute, onSeeAgent, onSeeLate, onOpenRules, distributing }: {
  view: DeskView; month: string; locale: string; marketId: string;
  onDistribute: () => void; onSeeAgent: (id: string) => void; onSeeLate: () => void; onOpenRules: () => void; distributing: boolean;
}) {
  const t = useTranslations("prospects.desk");
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const h = view.hero;
  const b = (c: React.ReactNode) => <b>{c}</b>;
  const n = (c: React.ReactNode) => <span className="n">{c}</span>;

  const answer = h.empty ? (
    <div className="tb-a">
      <span className="tb-l">{t("band.leadEmpty", { month: monthName(month, locale) })}</span>
      <div className="tb-n zero"><b className="num">0</b> {t("band.delivered", { n: 0 })} <i>·</i> <b className="num">{fmtMoney(0, locale, marketId)}</b></div>
      <span className="tb-m">{t("band.moreEmpty")}</span>
    </div>
  ) : (
    <div className="tb-a">
      <span className="tb-l">{t("band.lead", { month: monthName(month, locale) })}</span>
      <div className="tb-n">
        <bdi><b className="num">{fmtNum(h.delivered, locale)}</b> {t("band.delivered", { n: h.delivered })}</bdi> <i>·</i>{" "}
        <bdi><b className="num">{fmtMoney(h.revenue, locale, marketId)}</b></bdi>
        {h.trend !== null && h.trend !== 0 ? (
          <span className={`tr ${h.trend > 0 ? "good" : "bad"}`} data-tip={t("band.trend", { month: monthName(shiftMonth(month, -1), locale), n: h.prev_delivered })}>
            <ArrowUp className="ic" style={h.trend < 0 ? { transform: "rotate(180deg)" } : undefined} />{Math.abs(h.trend)}
          </span>
        ) : null}
      </div>
      <span className="tb-m">{t.rich("band.more", { all: h.converted, road: h.on_road, wait: h.not_shipped, ret: h.returned, b })}</span>
    </div>
  );

  let zone: React.ReactNode;
  if (view.engineOff) {
    zone = (
      <button type="button" className="tb-t act" onClick={onOpenRules}>
        <span className="tb-ti"><PowerOff className="ic" /></span>
        <div><b>{t("band.off")}</b><small>{t("band.offSub")}</small></div>
      </button>
    );
  } else if (view.calm) {
    const active = view.agents.filter((a) => a.file_open > 0).length;
    zone = (
      <div className="tb-t ok">
        <span className="tb-ti"><Check className="ic" /></span>
        <div><b>{t("band.calm")}</b><small>{t("band.calmSub", { open: fmtNum(view.openTotal, locale), agents: active })}</small></div>
      </div>
    );
  } else {
    const summary = view.todo.map((item) => {
      const label = item.kind === "pool" ? t("todo.poolShort", { n: item.n })
        : item.kind === "stale" ? t("todo.staleShort", { n: item.n, agent: item.agentName })
        : t("todo.lateShort", { n: item.n });
      return <span key={`${item.kind}-${"agentId" in item ? item.agentId : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i className={`d ${item.severity}`} />{label}</span>;
    });
    zone = (
      <div ref={ref}>
        <button type="button" className={`tb-t act${open ? " open" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="tb-ti bad"><Bell className="ic" /><i>{view.todo.length}</i></span>
          <div><b>{t("band.todo")}</b><small>{summary}</small></div>
          <ChevronDown className={`ic${open ? " rot" : ""}`} />
        </button>
        {open ? (
          <div className="tpanel" role="region" aria-label={t("band.todo")}>
            {view.todo.map((item) => {
              if (item.kind === "pool") return (
                <div key="pool" className="tline bad">
                  <span className="ti"><UserX className="ic" /></span>
                  <div className="tt"><b>{t.rich("todo.pool", { n: item.n, hl: n })}</b><p>{t("todo.poolSub", { cap: view.fileCap })}</p></div>
                  <button type="button" className="btn pri sm" disabled={distributing} onClick={() => { setOpen(false); onDistribute(); }}>{t("todo.distribute")}</button>
                </div>
              );
              if (item.kind === "stale") return (
                <div key={`stale-${item.agentId}`} className="tline warn">
                  <span className="ti"><Hourglass className="ic" /></span>
                  <div className="tt"><b>{t.rich("todo.stale", { n: item.n, days: view.releaseDays, agent: item.agentName, hl: n })}</b><p>{t("todo.staleSub")}</p></div>
                  <button type="button" className="btn sec sm" onClick={() => { setOpen(false); onSeeAgent(item.agentId); }}>{t("todo.see")}</button>
                </div>
              );
              return (
                <div key="late" className="tline warn">
                  <span className="ti"><Clock className="ic" /></span>
                  <div className="tt"><b>{t.rich("todo.late", { n: item.n, hl: n })}</b><p>{item.byAgent.map((a) => `${a.name} (${a.n})`).join(" · ")}</p></div>
                  <button type="button" className="btn sec sm" onClick={() => { setOpen(false); onSeeLate(); }}>{t("todo.see")}</button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="card topband">
      {answer}
      <span className="tb-sep" />
      <div className="tb-z">{zone}</div>
    </section>
  );
}
