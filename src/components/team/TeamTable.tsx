"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { getPresence, PRESENCE_COLOR, PRESENCE_LABEL } from "@/lib/presence";
import { Avatar } from "@/components/ui/Avatar";
import { GoalBar } from "./GoalBar";
import { AgentSparklineCell } from "./AgentSparklineCell";

interface RegionBreakdown {
  city: string;
  count: number;
  percentage: number;
}

export interface TeamTableAgent {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  role: "agent" | "market_manager";
  last_seen_at: string | null;
  queue_size: number;
  actioned_period: number;
  confirmed_period: number;
  rejected_period: number;
  confirmation_rate_period: number;
  calls_period: number;
  avg_attempts: number;
  fcr: number;
  ttfc_median: number | null;
  rejection_regions: RegionBreakdown[];
  percentile_rank: number;
}

interface SparklinePoint {
  day: string;
  rate: number | null;
}

interface TeamTableProps {
  agents: TeamTableAgent[];
  sparklines: Record<string, SparklinePoint[]>;
  target: number;
  onDrilldown: (agent: TeamTableAgent) => void;
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #D1D5DB",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #E6E7E9",
};

const tdRight: React.CSSProperties = {
  ...tdStyle,
  textAlign: "end",
  fontVariantNumeric: "tabular-nums",
};

const thRight: React.CSSProperties = {
  ...thStyle,
  textAlign: "end",
};

// Descriptive tint: rate < 50% of target → red, < 100% of target → amber, else neutral
function rateTint(rate: number, target: number): React.CSSProperties {
  if (rate < target * 0.5) return { color: "#D72C0D", fontWeight: 600 };
  if (rate < target) return { color: "#D97706" };
  return { color: "#008060", fontWeight: 600 };
}

function fcrTint(fcr: number): React.CSSProperties {
  if (fcr < 40) return { color: "#D72C0D" };
  if (fcr < 60) return { color: "#D97706" };
  return { color: "#008060" };
}

// Lower = better for TTFC (minutes)
function ttfcTint(minutes: number | null): React.CSSProperties {
  if (minutes === null) return { color: "#9CA3AF" };
  if (minutes > 60) return { color: "#D72C0D" };
  if (minutes > 20) return { color: "#D97706" };
  return { color: "#008060" };
}

function formatTtfc(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

const Row = memo(function Row({
  agent,
  rank,
  sparkline,
  target,
  onDrilldown,
}: {
  agent: TeamTableAgent;
  rank: number;
  sparkline: SparklinePoint[];
  target: number;
  onDrilldown: (a: TeamTableAgent) => void;
}) {
  const presence = getPresence(agent.last_seen_at);
  return (
    <tr
      style={{ background: "white", cursor: "pointer" }}
      onClick={() => onDrilldown(agent)}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = "#FAFBFB";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLTableRowElement).style.background = "white";
      }}
    >
      <td style={{ ...tdRight, color: "#6D7175", width: 40 }}>{rank}</td>
      <td style={{ ...tdStyle, fontWeight: 500 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar
            user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
            size={28}
          />
          <span
            title={PRESENCE_LABEL[presence]}
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: PRESENCE_COLOR[presence],
              flexShrink: 0,
            }}
          />
          <span>{agent.full_name}</span>
          {agent.role === "market_manager" && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: "#6B7280",
                backgroundColor: "#F3F4F6",
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              MGR
            </span>
          )}
        </div>
      </td>
      <td style={tdRight}>{agent.queue_size}</td>
      <td style={tdRight}>{agent.calls_period}</td>
      <td style={tdRight}>{agent.actioned_period}</td>
      <td style={tdRight}>{agent.confirmed_period}</td>
      <td style={tdRight}>{agent.rejected_period}</td>
      <td style={tdRight}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <span style={rateTint(agent.confirmation_rate_period, target)}>
            {agent.confirmation_rate_period.toFixed(1)}%
          </span>
          <GoalBar rate={agent.confirmation_rate_period} target={target} />
        </div>
      </td>
      <td style={{ ...tdRight, ...fcrTint(agent.fcr) }}>{agent.fcr.toFixed(0)}%</td>
      <td style={{ ...tdRight, ...ttfcTint(agent.ttfc_median) }}>
        {formatTtfc(agent.ttfc_median)}
      </td>
      <td style={tdRight}>{agent.avg_attempts.toFixed(1)}</td>
      <td style={tdStyle}>
        <div style={{ width: 80, height: 22 }}>
          <AgentSparklineCell series={sparkline} target={target} />
        </div>
      </td>
      <td style={{ ...tdStyle, minWidth: 140 }}>
        {agent.rejection_regions.length === 0 ? (
          <span style={{ color: "#9CA3AF" }}>—</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {agent.rejection_regions.map((r) => (
              <div
                key={r.city}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#374151",
                }}
              >
                <span
                  style={{
                    minWidth: 70,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.city}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    backgroundColor: "#F3F4F6",
                    borderRadius: 2,
                    minWidth: 40,
                  }}
                >
                  <div
                    style={{
                      width: `${r.percentage}%`,
                      height: "100%",
                      backgroundColor: "#D72C0D",
                      borderRadius: 2,
                    }}
                  />
                </div>
                <span style={{ color: "#6D7175", minWidth: 28, textAlign: "end" }}>
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
});

export function TeamTable({ agents, sparklines, target, onDrilldown }: TeamTableProps) {
  const t = useTranslations("teamPerf.table");
  const tPerf = useTranslations("teamPerf");

  return (
    <div
      style={{
        backgroundColor: "white",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflowX: "auto",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
        <thead>
          <tr>
            <th style={thRight}>#</th>
            <th style={{ ...thStyle, textAlign: "start" }}>{t("agent")}</th>
            <th style={thRight}>{t("queue")}</th>
            <th style={thRight}>{t("calls")}</th>
            <th style={thRight}>{t("actioned")}</th>
            <th style={thRight}>{t("confirmed")}</th>
            <th style={thRight}>{t("rejected")}</th>
            <th style={thRight}>{t("rate")}</th>
            <th style={thRight}>{t("fcr")}</th>
            <th style={thRight}>{t("ttfc")}</th>
            <th style={thRight}>{t("attempts")}</th>
            <th style={{ ...thStyle, textAlign: "start" }}>{t("trend")}</th>
            <th style={{ ...thStyle, textAlign: "start" }}>{t("rejectRegions")}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent, i) => (
            <Row
              key={agent.agent_id}
              agent={agent}
              rank={i + 1}
              sparkline={sparklines[agent.agent_id] ?? []}
              target={target}
              onDrilldown={onDrilldown}
            />
          ))}
          {agents.length === 0 && (
            <tr>
              <td
                colSpan={13}
                style={{ ...tdStyle, color: "#6D7175", textAlign: "center", padding: 32 }}
              >
                {tPerf("empty")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
