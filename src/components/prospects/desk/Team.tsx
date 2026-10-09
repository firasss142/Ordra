"use client";

/**
 * One card per agent (owner's pick: today + this month): a thin ring of
 * prospects called today out of her file, one warning at most, and what she
 * delivered this month. Her identity colour has presence (design-system §4.2).
 */
import { useTranslations } from "next-intl";
import { Clock, Hourglass } from "lucide-react";
import type { AgentCard } from "@/lib/prospects/desk/model";
import { agentColorVars } from "@/lib/team/agent-color";
import { fmtMoney, fmtNum } from "./format";
import { Avatar } from "./parts";

function Ring({ a }: { a: AgentCard }) {
  const r = 34, C = 2 * Math.PI * r;
  const f = a.ringTotal ? Math.min(1, a.called_today / a.ringTotal) : 0;
  const gap = f > 0 && f < 1 ? 3 : 0;
  return (
    <div className="rng">
      <svg viewBox="0 0 84 84" aria-hidden>
        <circle cx="42" cy="42" r={r} fill="none" stroke="color-mix(in srgb,var(--a5) 14%,transparent)" strokeWidth="9" />
        {f > 0 ? <circle cx="42" cy="42" r={r} fill="none" stroke="var(--a5)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${Math.max(0, C * f - gap)} ${C}`} /> : null}
      </svg>
      <b className={`num${a.called_today ? "" : " zero"}`}>{a.called_today}</b>
    </div>
  );
}

export function Team({ agents, selected, onToggle, locale, marketId, fileCap }: {
  agents: AgentCard[]; selected: string[]; onToggle: (id: string) => void; locale: string; marketId: string; fileCap: number;
}) {
  const t = useTranslations("prospects.desk.team");
  return (
    <>
      <div className="sh"><h2>{t("title")}</h2><small>{t("hint")}</small></div>
      {agents.length === 0 ? <div className="card empty">{t("empty")}</div> : (
        <section className="ags">
          {agents.map((a) => {
            const on = selected.includes(a.id);
            return (
              <button key={a.id} type="button" className={`ag${on ? " on" : ""}${a.online ? "" : " off"}`} style={agentColorVars(a.colorKey)} aria-pressed={on} onClick={() => onToggle(a.id)}>
                <div className="who">
                  <Avatar id={a.id} name={a.name} color={a.color} online={a.online} />
                  <div style={{ minWidth: 0 }}>
                    <div className="nm">{a.name}</div>
                    <div className="st">{a.online ? t("online") : t("offline")}{a.in_rotation ? "" : ` · ${t("outOfRotation")}`}</div>
                  </div>
                </div>
                <Ring a={a} />
                <div className="rl">{t("ring", { cap: Math.max(a.ringTotal, fileCap) })}</div>
                <div className="flag">
                  {a.flag?.kind === "stale" ? <span className="warn"><Hourglass className="ic" />{t("stale", { n: a.flag.n })}</span> : null}
                  {a.flag?.kind === "late" ? <span className="warn"><Clock className="ic" />{t("late", { n: a.flag.n })}</span> : null}
                </div>
                <div className="mo" data-tip={t("monthTip", { won: a.converted_month, n: a.delivered_month })}>
                  <span className="num">{t.rich("month", { n: fmtNum(a.delivered_month, locale), amount: fmtMoney(a.revenue_month, locale, marketId), b: (c) => <b>{c}</b> })}</span>
                  <small>{t("monthSub")}</small>
                </div>
              </button>
            );
          })}
        </section>
      )}
    </>
  );
}
