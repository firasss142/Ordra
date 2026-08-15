"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Flame } from "lucide-react";
import type { PerformanceView, PerfAgentView } from "@/lib/team/view-models";
import { formatActiveMinutes } from "@/lib/team/goals";
import { fmtNum, fmtPct } from "@/lib/team/format";
import { AgentAvatar } from "./AgentAvatar";
import { TeamCard } from "./Card";

interface Props {
  view: PerformanceView;
  locale: string;
  productKey: string | null;
  onSelectAgent: (id: string) => void;
  onSetTarget: (agentId: string, metric: "min_rate" | "throughput", value: number) => Promise<void>;
  canSetTargets: boolean;
}

function rateTone(r: number | null, min: number): string {
  if (r === null) return "text-ink-muted";
  if (r >= min + 5) return "text-status-success";
  if (r >= min - 10) return "text-oms-age-warm";
  return "text-status-critical";
}

export function RankingCard({ view, locale, productKey, onSelectAgent, onSetTarget, canSetTargets }: Props) {
  const t = useTranslations("team.perf.ranking");
  const [busy, setBusy] = useState<string | null>(null);
  const target = view.team.confPerHourTarget;

  function productRate(v: PerfAgentView): { rate: number | null; treated: number } | null {
    if (!productKey) return null;
    const p = v.agent.products.find((x) => x.key === productKey);
    if (!p) return { rate: null, treated: 0 };
    return { rate: p.treated >= 10 ? Math.round((p.confirmed / p.treated) * 1000) / 10 : null, treated: p.treated };
  }

  return (
    <TeamCard className="flex flex-col">
      <header className="flex flex-col gap-0.5 border-b border-line-subtle px-4 py-3.5">
        <h2 className="text-[16px] font-semibold text-ink-primary">{t("title")}</h2>
        <span className="text-[12.5px] text-ink-secondary">{t("hint", { target: fmtNum(locale, target, 1) })}</span>
      </header>
      {view.ranked.length === 0 && <p className="px-4 py-6 text-[13.5px] text-ink-secondary">{t("empty")}</p>}
      {view.ranked.map((r) => {
        const pr = productRate(r);
        const rate = pr ? pr.rate : r.rate;
        const pct = Math.min(100, Math.round((r.confPerHour / target) * 100));
        const cta = r.coaching;
        return (
          <div
            key={r.agent.agent_id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectAgent(r.agent.agent_id)}
            onKeyDown={(e) => { if (e.key === "Enter") onSelectAgent(r.agent.agent_id); }}
            className="relative flex cursor-pointer items-center gap-3.5 border-b border-line-subtle px-4 pb-4 pt-7 last:border-b-0 hover:bg-surface-hover"
          >
            <div className="w-[22px] text-center text-[28px] font-semibold tabular-nums text-ink-primary">{r.rank}</div>
            <AgentAvatar name={r.agent.name} avatarUrl={r.agent.avatar_url} />
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold text-ink-primary">{r.agent.name}</div>
              <div className="mt-1 whitespace-nowrap text-[12.5px] text-ink-secondary tabular-nums">
                {pr ? t("productRate") : t("rate")} <b className={`font-semibold ${rateTone(rate, r.targets.minRate)}`}>{fmtPct(locale, rate)}</b>
                {" · "}{t("throughput")} <b className="font-semibold text-ink-primary">{r.throughput === null ? "—" : `${fmtNum(locale, r.throughput, 1)}/h`}</b>
                {" · "}{formatActiveMinutes(r.agent.active_minutes)}{" · "}{t("days", { n: r.agent.days_active })}
                {pr && <> · <b className="font-semibold text-ink-primary">{fmtNum(locale, pr.treated)}</b> {t("treated")}</>}
              </div>
              {cta && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    disabled={!canSetTargets || busy === r.agent.agent_id}
                    title={canSetTargets ? t("ctaTitle") : t("ctaNoPerm")}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!canSetTargets) return;
                      setBusy(r.agent.agent_id);
                      try {
                        await onSetTarget(r.agent.agent_id, cta.metric === "rate" ? "min_rate" : "throughput", cta.value);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-card px-2.5 py-1 text-[11.5px] font-medium text-ink-primary hover:bg-surface-hover disabled:cursor-default disabled:opacity-70"
                  >
                    <ArrowRight size={12} aria-hidden="true" />
                    {cta.metric === "rate" ? t("ctaRate", { v: fmtNum(locale, cta.value) }) : t("ctaThroughput", { v: fmtNum(locale, cta.value) })}
                  </button>
                </div>
              )}
            </div>
            <div className="flex min-w-[130px] shrink-0 flex-col items-end gap-1.5">
              <div className="flex items-baseline gap-1.5 text-[22px] font-bold leading-none tabular-nums text-ink-primary">
                {fmtNum(locale, r.confPerHour, 1)}<small className="text-[12px] font-medium text-ink-secondary">{t("confPerHour")}</small>
              </div>
              <div className="relative h-1.5 w-[112px] overflow-hidden rounded-pill bg-[#EAECEE]">
                <i className="absolute inset-y-0 start-0 rounded-pill bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-[11px] tabular-nums text-ink-secondary">{fmtNum(locale, r.confPerHour, 1)} / {fmtNum(locale, target, 1)}</div>
            </div>
            <div className="absolute end-4 top-3 flex items-center gap-1 text-[11.5px] tabular-nums text-ink-secondary" title={t("streakTitle", { best: r.streak.best })}>
              <Flame size={12} aria-hidden="true" />
              {t("streak", { n: r.streak.current })}
            </div>
          </div>
        );
      })}
      {view.unranked.length > 0 && (
        <footer className="px-4 py-[11px] text-[12.5px] text-ink-secondary">
          {t("unranked")}{" "}
          {view.unranked.map((u, i) => (
            <span key={u.agent.agent_id}>
              {i > 0 && " · "}
              <button type="button" onClick={() => onSelectAgent(u.agent.agent_id)} className="hover:underline">
                {u.agent.name} ({u.reason === "no_activity" ? t("noActivity") : t("littleActivity", { time: formatActiveMinutes(u.agent.active_minutes) })})
              </button>
            </span>
          ))}
        </footer>
      )}
    </TeamCard>
  );
}
