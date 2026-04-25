"use client";

import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import { GoalBar } from "./GoalBar";
import { AgentSparklineCell } from "./AgentSparklineCell";

interface SparklinePoint {
  day: string;
  rate: number | null;
}

interface LeaderboardAgent {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  confirmation_rate_period: number;
  actioned_period: number;
  percentile_rank: number;
  streak?: number;
}

interface TeamLeaderboardProps {
  agents: LeaderboardAgent[];
  sparklines: Record<string, SparklinePoint[]>;
  target: number;
  onDrilldown: (agentId: string) => void;
}

const MEDAL = ["🥇", "🥈", "🥉"];
const MEDAL_COLOR = ["#D4A017", "#9CA3AF", "#CD7F32"];

export function TeamLeaderboard({ agents, sparklines, target, onDrilldown }: TeamLeaderboardProps) {
  const t = useTranslations("teamPerf");
  const top3 = agents.slice(0, 3);

  if (top3.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #E1E3E5",
          fontSize: 13,
          fontWeight: 600,
          color: "#1A1A1A",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {t("leaderboard.title")}
      </div>

      <div style={{ display: "flex", gap: 0 }}>
        {top3.map((agent, i) => {
          const series = sparklines[agent.agent_id] ?? [];
          return (
            <button
              key={agent.agent_id}
              type="button"
              onClick={() => onDrilldown(agent.agent_id)}
              style={{
                flex: 1,
                padding: "20px 16px",
                background: "none",
                border: "none",
                borderRight: i < top3.length - 1 ? "1px solid #E1E3E5" : "none",
                cursor: "pointer",
                textAlign: "start",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FAFBFB"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>{MEDAL[i]}</span>
                <Avatar
                  user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
                  size={32}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#1A1A1A",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {agent.full_name}
                  </div>
                  {agent.streak !== undefined && agent.streak > 1 && (
                    <div
                      style={{
                        marginTop: 2,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        color: "#008060",
                        background: "rgba(0,128,96,0.08)",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                    >
                      🔥 {t("leaderboard.streak", { n: agent.streak })}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                <div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: MEDAL_COLOR[i],
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: 1,
                    }}
                  >
                    {agent.confirmation_rate_period.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                    {agent.actioned_period} {t("table.actioned").toLowerCase()}
                  </div>
                  <GoalBar rate={agent.confirmation_rate_period} target={target} />
                </div>
                <div style={{ width: 60, height: 24, flexShrink: 0 }}>
                  <AgentSparklineCell series={series} target={target} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
