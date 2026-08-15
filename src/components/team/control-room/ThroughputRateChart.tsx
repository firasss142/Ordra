"use client";

import { useTranslations } from "next-intl";
import type { PerformanceView } from "@/lib/team/view-models";
import { agentColor, fmtNum, fmtPct } from "@/lib/team/format";
import { TeamCard, TeamCardHead } from "./Card";

/**
 * Carte débit × taux — every ranked agent as a dot on throughput (x) against
 * confirmation rate (y). Dashed references at the team rate and the median
 * throughput; the top-right quadrant is the target and is tinted. Plain SVG:
 * four to eight points do not need a charting library, and the design system
 * forbids the extra ink recharts adds.
 */
export function ThroughputRateChart({ view, locale }: { view: PerformanceView; locale: string }) {
  const t = useTranslations("team.perf.chart");
  const pts = view.ranked.filter((r) => r.rate !== null && r.throughput !== null);
  const W = 560, H = 290, L = 44, R = 16, T = 20, B = 50;
  const maxX = Math.max(16, Math.ceil(Math.max(0, ...pts.map((p) => p.throughput!)) / 4) * 4);
  const maxY = Math.max(60, Math.ceil(Math.max(0, ...pts.map((p) => p.rate!)) / 20) * 20);
  const x = (v: number) => L + (v / maxX) * (W - L - R);
  const y = (v: number) => H - B - (v / maxY) * (H - B - T);
  const refX = view.team.medianThroughput ?? maxX / 2;
  const refY = view.team.rate ?? maxY / 2;
  const xticks = Array.from({ length: 5 }, (_, i) => Math.round((maxX / 4) * i));
  const yticks = Array.from({ length: 4 }, (_, i) => Math.round((maxY / 3) * i));

  return (
    <TeamCard>
      <TeamCardHead title={t("title")} />
      <div className="px-4 pb-1.5 pt-3.5">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t("aria")}>
          <rect x={x(refX)} y={T} width={W - R - x(refX)} height={y(refY) - T} fill="#EAF6EE" rx="4" />
          <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="#E1E3E5" />
          <line x1={L} y1={T} x2={L} y2={H - B} stroke="#E1E3E5" />
          {yticks.slice(1).map((v) => <line key={`gy${v}`} x1={L} y1={y(v)} x2={W - R} y2={y(v)} stroke="#F0F1F2" />)}
          {xticks.slice(1).map((v) => <line key={`gx${v}`} x1={x(v)} y1={T} x2={x(v)} y2={H - B} stroke="#F0F1F2" />)}
          <line x1={x(refX)} y1={T} x2={x(refX)} y2={H - B} stroke="#8C9196" strokeWidth="1.3" strokeDasharray="4 4" />
          <line x1={L} y1={y(refY)} x2={W - R} y2={y(refY)} stroke="#8C9196" strokeWidth="1.3" strokeDasharray="4 4" />
          <text x={L + 8} y={T + 16} fontSize="10" fill="#8C9196" fontWeight="600" letterSpacing="1">{t("q.reliableSlow").toUpperCase()}</text>
          <text x={W - R - 8} y={T + 16} fontSize="10" fill="#15803D" fontWeight="700" letterSpacing="1" textAnchor="end">{t("q.target").toUpperCase()}</text>
          <text x={L + 8} y={H - B - 8} fontSize="10" fill="#8C9196" fontWeight="600" letterSpacing="1">{t("q.weak").toUpperCase()}</text>
          <text x={W - R - 8} y={H - B - 8} fontSize="10" fill="#8C9196" fontWeight="600" letterSpacing="1" textAnchor="end">{t("q.fastLossy").toUpperCase()}</text>
          <text x={L + 3} y={y(refY) + 11} fontSize="9.5" fill="#8C9196">{t("refTeam", { rate: fmtPct(locale, view.team.rate) })}</text>
          <text x={x(refX) + 4} y={H - B - 20} fontSize="9.5" fill="#8C9196">{t("refMedian", { v: view.team.medianThroughput === null ? "—" : fmtNum(locale, view.team.medianThroughput, 1) })}</text>
          {xticks.map((v) => <text key={`xt${v}`} x={x(v)} y={H - B + 16} fontSize="10" fill="#8C9196" textAnchor="middle">{fmtNum(locale, v)}</text>)}
          {yticks.map((v) => <text key={`yt${v}`} x={L - 6} y={y(v) + 3} fontSize="10" fill="#8C9196" textAnchor="end">{fmtNum(locale, v)}</text>)}
          <text x={W - R} y={H - 14} fontSize="10.5" fill="#6D7175" textAnchor="end">{t("xAxis")}</text>
          <text x={4} y={12} fontSize="10.5" fill="#6D7175">{t("yAxis")}</text>
          {pts.map((p) => {
            const cx = x(p.throughput!), cy = y(p.rate!);
            const labelEnd = cx > W - 90;
            return (
              <g key={p.agent.agent_id}>
                <title>{`${p.agent.name} — ${fmtNum(locale, p.throughput!, 1)} ${t("xAxis")} · ${fmtPct(locale, p.rate)}`}</title>
                <circle cx={cx} cy={cy} r="10" fill={agentColor(p.agent.name)} stroke="#FFFFFF" strokeWidth="2" />
                <text x={cx} y={cy + 3.5} fontSize="9.5" fill="#FFFFFF" textAnchor="middle" fontWeight="700">{p.agent.name[0]?.toUpperCase()}</text>
                <text x={labelEnd ? cx - 14 : cx + 15} y={cy + 4} fontSize="11.5" fill="#1A1A1A" fontWeight="600" textAnchor={labelEnd ? "end" : "start"}>{p.agent.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </TeamCard>
  );
}
