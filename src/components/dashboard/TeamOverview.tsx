"use client";

import { useState } from "react";
import useSWR from "swr";
import { AgentDrilldown } from "@/components/team/AgentDrilldown";
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
  fontSize: 12,
  fontWeight: 600,
  color: "#6B7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E5E7EB",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E5E7EB",
};

const tdRight: React.CSSProperties = { ...tdStyle, textAlign: "end", fontVariantNumeric: "tabular-nums" };
const thRight: React.CSSProperties = { ...thStyle, textAlign: "end" };
const thCenter: React.CSSProperties = { ...thStyle, textAlign: "center" };
const tdCenter: React.CSSProperties = { ...tdStyle, textAlign: "center" };

export function TeamOverview() {
  const [selectedAgent, setSelectedAgent] = useState<{ id: string; name: string; marketId: string } | null>(null);

  const { data, mutate, error, isLoading } = useSWR<{ data: TeamAgent[] }>(
    "/api/team",
    { refreshInterval: 60000, revalidateOnFocus: false }
  );

  const agents = data?.data ?? [];

  function closeDrilldown() {
    setSelectedAgent(null);
    mutate();
  }

  if (isLoading) {
    return (
      <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#6B7280" }}>
        Chargement...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "48px 16px", textAlign: "center", fontSize: 14, color: "#DC2626" }}>
        Erreur de chargement
      </div>
    );
  }

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "start" }}>Agent</th>
              <th style={thCenter}>Statut</th>
              <th style={thRight}>File d&apos;attente</th>
              <th style={thRight}>Traitées</th>
              <th style={thRight}>Confirmées</th>
              <th style={thRight}>Rejetées</th>
              <th style={thRight}>Taux</th>
              <th style={thRight}>Moy. tentatives</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const presence = getPresence(agent.last_seen_at);
              return (
                <tr
                  key={agent.agent_id}
                  style={{ background: "white", cursor: "pointer" }}
                  onClick={() => setSelectedAgent({ id: agent.agent_id, name: agent.full_name, marketId: agent.market_id })}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = "#F9FAFB";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = "white";
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar
                        user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
                        size={28}
                      />
                      <span>{agent.full_name}</span>
                    </div>
                    {agent.role === "market_manager" && (
                      <span
                        style={{
                          marginInlineStart: 8,
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
                  </td>
                  <td style={tdCenter}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: PRESENCE_COLOR[presence],
                      }}
                      title={PRESENCE_LABEL[presence]}
                    />
                  </td>
                  <td style={tdRight}>{agent.queue_size}</td>
                  <td style={tdRight}>{agent.actioned_today}</td>
                  <td style={tdRight}>{agent.confirmed_today}</td>
                  <td style={tdRight}>{agent.rejected_today}</td>
                  <td style={tdRight}>{agent.confirmation_rate.toFixed(1)}%</td>
                  <td style={tdRight}>{agent.avg_attempts.toFixed(1)}</td>
                </tr>
              );
            })}
            {agents.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{ ...tdStyle, color: "#6B7280", textAlign: "center", padding: 32 }}
                >
                  Aucun agent dans ce marché
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedAgent && (
        <AgentDrilldown
          agentId={selectedAgent.id}
          agentName={selectedAgent.name}
          marketId={selectedAgent.marketId}
          onClose={closeDrilldown}
        />
      )}
    </>
  );
}
