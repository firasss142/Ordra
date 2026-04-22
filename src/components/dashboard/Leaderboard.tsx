"use client";

import { Avatar } from "@/components/ui/Avatar";

interface AgentMetric {
  agent_id: string;
  full_name: string;
  avatar_url?: string | null;
  actioned: number;
  confirmation_rate: number;
}

interface LeaderboardProps {
  agents: AgentMetric[];
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
};

const thRight: React.CSSProperties = {
  ...thStyle,
  textAlign: "end",
};

export function Leaderboard({ agents }: LeaderboardProps) {
  const ranked = [...agents]
    .filter((a) => a.actioned > 0)
    .sort((a, b) => b.confirmation_rate - a.confirmation_rate);

  if (ranked.length === 0) {
    return (
      <div
        style={{
          padding: "48px 16px",
          textAlign: "center",
          fontSize: 14,
          color: "#6D7175",
        }}
      >
        Aucune donnée pour la période sélectionnée
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "end", width: 48 }}>Rang</th>
            <th style={{ ...thStyle, textAlign: "start" }}>Agent</th>
            <th style={thRight}>Taux confirmation</th>
            <th style={thRight}>Traitées</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((agent, index) => (
            <tr
              key={agent.agent_id}
              style={{ background: index === 0 ? "#F9FAFB" : "white" }}
            >
              <td style={{ ...tdRight, color: "#6D7175" }}>{index + 1}</td>
              <td style={{ ...tdStyle, fontWeight: 500 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar
                    user={{ full_name: agent.full_name, avatar_url: agent.avatar_url ?? null }}
                    size={26}
                  />
                  {agent.full_name}
                </div>
              </td>
              <td style={tdRight}>{agent.confirmation_rate.toFixed(1)}%</td>
              <td style={tdRight}>{agent.actioned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
