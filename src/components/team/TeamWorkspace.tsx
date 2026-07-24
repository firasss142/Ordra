"use client";

import { useCallback, useState, useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import { computeStreak } from "@/lib/team/streak";
import { medianMinutes } from "@/lib/team/ttfc";
import { TeamLeaderboard } from "./TeamLeaderboard";
import { TeamTable, type TeamTableAgent } from "./TeamTable";
import { AgentDrilldown } from "./AgentDrilldown";
import { PeriodSelector, type Period, type PeriodPreset } from "@/components/shared/PeriodSelector";
import { todayISO } from "@/lib/date";
import type { Role } from "@/types";

const jsonFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

function yesterdayISO(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface TeamAgent extends TeamTableAgent {
  market_id: string;
  prev_confirmation_rate: number | null;
}

interface SparklinePoint {
  day: string;
  rate: number | null;
}

interface SparklineEntry {
  agent_id: string;
  series: SparklinePoint[];
}

interface TeamWorkspaceProps {
  role: Role;
  marketId: string | null;
}

function buildTeamUrl(period: Period, marketId: string | null): string {
  const p = new URLSearchParams({
    from_date: period.from_date,
    to_date: period.to_date,
  });
  if (marketId) p.set("market_id", marketId);
  return `/api/team?${p.toString()}`;
}

function buildSparklinesUrl(agentIds: string[], marketId: string | null): string | null {
  if (agentIds.length === 0) return null;
  const p = new URLSearchParams({ agent_ids: agentIds.join(","), days: "14" });
  if (marketId) p.set("market_id", marketId);
  return `/api/team/sparklines?${p.toString()}`;
}

function formatTtfc(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function TeamWorkspace({ role, marketId }: TeamWorkspaceProps) {
  const t = useTranslations("teamPerf");
  const yesterday = yesterdayISO();
  const [period, setPeriod] = useState<Period>({ from_date: yesterday, to_date: yesterday });
  const [preset, setPreset] = useState<PeriodPreset>("yesterday");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const teamUrl = buildTeamUrl(period, marketId);
  const { data: teamData, mutate: mutateTeam } = useSWR<{ data: TeamAgent[] }>(
    teamUrl,
    jsonFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  // Realtime: order changes (status, assignment) affect queue size +
  // confirmation rate per agent. Debounced revalidation.
  const teamRealtimeHandler = useCallback(() => {
    void mutateTeam();
  }, [mutateTeam]);
  useRealtimeSubscribe({ table: "orders", marketId }, teamRealtimeHandler);

  const agents = useMemo(() => teamData?.data ?? [], [teamData]);

  const sparklinesUrl = buildSparklinesUrl(agents.map((a) => a.agent_id), marketId);
  const { data: sparklinesData } = useSWR<{ data: SparklineEntry[] }>(
    sparklinesUrl,
    jsonFetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false, keepPreviousData: true }
  );

  const settingsUrl = marketId ? `/api/settings/${marketId}` : null;
  const { data: settingsData } = useSWR<{ data: Record<string, unknown> | Array<{ key: string; value: unknown }> }>(
    settingsUrl,
    jsonFetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  const target = useMemo<number>(() => {
    if (!settingsData?.data) return 70;
    const raw = (settingsData.data as { confirmation_rate_target?: unknown }).confirmation_rate_target;
    if (typeof raw === "number") return raw;
    if (Array.isArray(settingsData.data)) {
      const row = settingsData.data.find((r) => r.key === "confirmation_rate_target");
      if (row && typeof row.value === "number") return row.value;
    }
    return 70;
  }, [settingsData]);

  const sparklineMap = useMemo<Record<string, SparklinePoint[]>>(() => {
    const map: Record<string, SparklinePoint[]> = {};
    for (const entry of sparklinesData?.data ?? []) {
      map[entry.agent_id] = entry.series;
    }
    return map;
  }, [sparklinesData]);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => b.confirmation_rate_period - a.confirmation_rate_period),
    [agents]
  );

  const agentsWithStreaks = useMemo(
    () =>
      sortedAgents.map((a) => {
        const series = sparklineMap[a.agent_id] ?? [];
        const newestFirst = [...series].reverse();
        return { ...a, streak: computeStreak(newestFirst, target) };
      }),
    [sortedAgents, sparklineMap, target]
  );

  const onlineCount = agents.filter((a) => {
    const ms = a.last_seen_at ? Date.now() - new Date(a.last_seen_at).getTime() : Infinity;
    return ms < 5 * 60 * 1000;
  }).length;

  const avgRate = agents.length > 0
    ? agents.reduce((s, a) => s + a.confirmation_rate_period, 0) / agents.length
    : 0;
  const totalActioned = agents.reduce((s, a) => s + a.actioned_period, 0);
  const totalCalls = agents.reduce((s, a) => s + a.calls_period, 0);
  const ttfcOverall = medianMinutes(agents.map((a) => a.ttfc_median));
  const activeAgentsWithFcr = agents.filter((a) => a.confirmed_period > 0);
  const avgFcr = activeAgentsWithFcr.length > 0
    ? activeAgentsWithFcr.reduce((s, a) => s + a.fcr, 0) / activeAgentsWithFcr.length
    : 0;

  const selectedAgent = selectedAgentId
    ? agents.find((a) => a.agent_id === selectedAgentId)
    : null;

  function openDrilldown(agent: { agent_id: string }) {
    setSelectedAgentId(agent.agent_id);
  }

  function closeDrilldown() {
    setSelectedAgentId(null);
    mutateTeam();
  }

  const kpiCardStyle: React.CSSProperties = {
    backgroundColor: "#FFFFFF",
    border: "1px solid #E1E3E5",
    borderRadius: 8,
    padding: "14px 18px",
    flex: 1,
    minWidth: 150,
  };
  const kpiLabelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "#6D7175",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  };
  const kpiValueStyle: React.CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    color: "#1A1A1A",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div>
      <PeriodSelector
        period={period}
        activePreset={preset}
        onChange={(p, pr) => { setPeriod(p); setPreset(pr); }}
        presets={["yesterday", "last7", "last30", "custom"]}
        maxDate={todayISO()}
      />

      {/* KPI strip: avg rate, calls total, FCR avg, TTFC median, agents online */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>{t("kpis.avgRate")}</div>
          <div style={kpiValueStyle}>{avgRate.toFixed(1)}%</div>
        </div>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>{t("kpis.totalCalls")}</div>
          <div style={kpiValueStyle}>{totalCalls}</div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
            {totalActioned} {t("table.actioned").toLowerCase()}
          </div>
        </div>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>{t("kpis.avgFcr")}</div>
          <div style={kpiValueStyle}>{avgFcr.toFixed(0)}%</div>
        </div>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>{t("kpis.ttfcMedian")}</div>
          <div style={kpiValueStyle}>{formatTtfc(ttfcOverall)}</div>
        </div>
        <div style={kpiCardStyle}>
          <div style={kpiLabelStyle}>{t("kpis.agentsOnline")}</div>
          <div style={kpiValueStyle}>{onlineCount}</div>
        </div>
      </div>

      <TeamLeaderboard
        agents={agentsWithStreaks}
        sparklines={sparklineMap}
        target={target}
        onDrilldown={(agentId) => openDrilldown({ agent_id: agentId })}
      />

      <TeamTable
        agents={sortedAgents}
        sparklines={sparklineMap}
        target={target}
        onDrilldown={openDrilldown}
      />

      {selectedAgentId && selectedAgent && (
        <AgentDrilldown
          agentId={selectedAgentId}
          agentName={selectedAgent.full_name}
          marketId={selectedAgent.market_id}
          percentileRank={selectedAgent.percentile_rank}
          role={role}
          onClose={closeDrilldown}
        />
      )}
    </div>
  );
}
