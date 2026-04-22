"use client";

import { memo, useState, useCallback } from "react";
import useSWR from "swr";
import { AgentDrilldown } from "./AgentDrilldown";
import { getAgentActivityState } from "@/lib/agent-activity";
import { getPresence, PRESENCE_COLOR, PRESENCE_LABEL } from "@/lib/presence";
import { Avatar } from "@/components/ui/Avatar";

interface TeamAgent {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  role: "agent" | "market_manager";
  is_active: boolean;
  is_active_today: boolean;
  last_seen_at: string | null;
  market_id: string;
  queue_size: number;
  actioned_today: number;
  confirmed_today: number;
  rejected_today: number;
  confirmation_rate: number;
  avg_attempts: number;
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #D1D5DB",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #D1D5DB",
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

const TeamAgentRow = memo(function TeamAgentRow({
  agent,
  onDrilldown,
}: {
  agent: TeamAgent;
  onDrilldown: (a: TeamAgent) => void;
}) {
  const presence = getPresence(agent.last_seen_at);
  const activity = getAgentActivityState(agent.is_active, agent.is_active_today);
  return (
    <tr
      style={{ background: "white", cursor: "pointer" }}
      onClick={() => onDrilldown(agent)}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#F7F7F7"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "white"; }}
    >
      <td style={{ ...tdStyle, fontWeight: 500 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar
            user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
            size={28}
          />
          <span
            title={PRESENCE_LABEL[presence]}
            style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: PRESENCE_COLOR[presence], flexShrink: 0 }}
          />
          {agent.full_name}
          {agent.role === "market_manager" && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#6B7280",
                backgroundColor: "#F3F4F6",
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Manager
            </span>
          )}
        </div>
      </td>
      <td style={tdRight}>{agent.queue_size}</td>
      <td style={tdRight}>{agent.actioned_today}</td>
      <td style={tdRight}>{agent.confirmed_today}</td>
      <td style={tdRight}>{agent.rejected_today}</td>
      <td style={tdRight}>{agent.confirmation_rate.toFixed(1)}%</td>
      <td style={tdRight}>{agent.avg_attempts.toFixed(1)}</td>
      <td style={tdStyle}>
        <span
          style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: activity.color, verticalAlign: "middle" }}
        />
        <span style={{ marginLeft: 6, fontSize: 14, color: activity.color }}>{activity.label}</span>
      </td>
    </tr>
  );
});

export function TeamTable() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedAgentMarketId, setSelectedAgentMarketId] = useState<string | undefined>(undefined);


  const { data, mutate } = useSWR<{ data: TeamAgent[] }>("/api/team", {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  });

  const agents = data?.data ?? [];

  const openDrilldown = useCallback((agent: TeamAgent) => {
    setSelectedAgentId(agent.agent_id);
    setSelectedAgentName(agent.full_name);
    setSelectedAgentMarketId(agent.market_id);
  }, []);

  function closeDrilldown() {
    setSelectedAgentId(null);
    setSelectedAgentName("");
    setSelectedAgentMarketId(undefined);
    mutate();
  }

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "start" }}>Agent</th>
              <th style={thRight}>File d&apos;attente</th>
              <th style={thRight}>Traitées aujourd&apos;hui</th>
              <th style={thRight}>Confirmées</th>
              <th style={thRight}>Rejetées</th>
              <th style={thRight}>Taux confirmation</th>
              <th style={thRight}>Moy. tentatives</th>
              <th style={{ ...thStyle, textAlign: "start" }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <TeamAgentRow key={agent.agent_id} agent={agent} onDrilldown={openDrilldown} />
            ))}
            {agents.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{ ...tdStyle, color: "#6D7175", textAlign: "center", padding: 32 }}
                >
                  Aucun agent dans ce marché
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedAgentId && (
        <AgentDrilldown
          agentId={selectedAgentId}
          agentName={selectedAgentName}
          marketId={selectedAgentMarketId}
          onClose={closeDrilldown}
        />
      )}
    </>
  );
}
