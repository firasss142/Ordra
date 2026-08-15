"use client";

import { useTranslations } from "next-intl";
import type { PerformanceView } from "@/lib/team/view-models";
import { formatActiveMinutes } from "@/lib/team/goals";
import { fmtDayShort, fmtNum } from "@/lib/team/format";
import { AgentAvatar } from "./AgentAvatar";
import { TeamCard, TeamCardHead } from "./Card";

const RAMP = ["#F5EFE1", "#E3F1EA", "#A9D6BE", "#5DB58E", "#0F7A5C"];
function level(min: number): number {
  if (min === 0) return 0;
  if (min < 60) return 1;
  if (min < 120) return 2;
  if (min < 180) return 3;
  return 4;
}

export function PresenceHeatmap({ view, locale, tz, onSelectAgent }: { view: PerformanceView; locale: string; tz: string; onSelectAgent: (id: string) => void }) {
  const t = useTranslations("team.perf.presence");
  const agents = Object.values(view.byId).sort((a, b) => b.agent.active_minutes - a.agent.active_minutes);
  const many = view.days.length > 14;
  return (
    <TeamCard>
      <TeamCardHead title={t("title")} hint={t("hint")} />
      <div className="overflow-x-auto px-2 pt-2">
        <table className="mx-2 my-0.5 border-separate" style={{ borderSpacing: "5px 6px" }}>
          <thead>
            <tr>
              <th className="px-1 pb-0.5 text-start text-[11px] font-medium uppercase tracking-[0.04em] text-ink-secondary">{t("agent")}</th>
              {view.days.map((d) => (
                <th key={d} className="px-1 pb-0.5 text-center text-[11px] font-medium uppercase leading-[1.3] tracking-[0.04em] text-ink-secondary">
                  {many ? d.slice(8) : fmtDayShort(locale, d, tz).split(" ").map((s, i) => <span key={i} className="block">{s}</span>)}
                </th>
              ))}
              <th className="px-1 pb-0.5 text-start text-[11px] font-medium uppercase tracking-[0.04em] text-ink-secondary">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((v) => {
              const total = v.heat.reduce((s, d) => s + d.active_minutes, 0);
              const days = v.heat.filter((d) => d.active_minutes > 0).length;
              return (
                <tr key={v.agent.agent_id} className="cursor-pointer" onClick={() => onSelectAgent(v.agent.agent_id)}>
                  <td className="whitespace-nowrap pe-2">
                    <span className="flex items-center gap-2.5">
                      <AgentAvatar name={v.agent.name} avatarUrl={v.agent.avatar_url} ghost={total === 0} />
                      <b className="text-[13.5px] font-semibold text-ink-primary">{v.agent.name}</b>
                    </span>
                  </td>
                  {v.heat.map((d) => (
                    <td key={d.day} className="p-0">
                      <div
                        className="rounded-md"
                        style={{ width: many ? 22 : 52, height: 28, background: RAMP[level(d.active_minutes)] }}
                        title={`${fmtDayShort(locale, d.day, tz)} · ${d.active_minutes ? `${formatActiveMinutes(d.active_minutes)} · ${fmtNum(locale, d.treated)} ${t("treated")} · ${fmtNum(locale, d.confirmed)} ${t("confirmed")}` : t("absent")}`}
                      />
                    </td>
                  ))}
                  <td className={`whitespace-nowrap ps-2.5 text-[13px] tabular-nums ${total === 0 ? "font-semibold text-status-critical" : "text-ink-primary"}`}>
                    {formatActiveMinutes(total)} · {t("days", { n: days })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3.5 px-4 pb-3.5 pt-2 text-[12px] text-ink-secondary">
        {[t("l0"), t("l1"), t("l2"), t("l3"), t("l4")].map((label, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-3 w-4 rounded-[3px]" style={{ background: RAMP[i], border: i === 0 ? "1px solid #E1E3E5" : undefined }} />
            {label}
          </span>
        ))}
      </div>
    </TeamCard>
  );
}
