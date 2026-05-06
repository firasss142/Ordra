"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { lastNDaysPeriod } from "@/lib/date";

interface AgentMetric {
  agent_id: string;
  full_name: string;
  avatar_url?: string | null;
  assigned: number;
  actioned: number;
  confirmed: number;
  rejected: number;
  confirmation_rate: number;
  avg_attempts: number;
}

export type Period = {
  from_date: string;
  to_date: string;
};

interface MetricsTableProps {
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
  fontVariantNumeric: "tabular-nums",
};

const thRight: React.CSSProperties = {
  ...thStyle,
  textAlign: "end",
};

export function MetricsTable({ agents }: MetricsTableProps) {
  if (agents.length === 0) {
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
            <th style={{ ...thStyle, textAlign: "start" }}>Agent</th>
            <th style={thRight}>Assignées</th>
            <th style={thRight}>Traitées</th>
            <th style={thRight}>Confirmées</th>
            <th style={thRight}>Rejetées</th>
            <th style={thRight}>Taux confirmation</th>
            <th style={thRight}>Moy. tentatives</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.agent_id} style={{ background: "white" }}>
              <td style={{ ...tdStyle, fontWeight: 500 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar
                    user={{ full_name: agent.full_name, avatar_url: agent.avatar_url ?? null }}
                    size={26}
                  />
                  {agent.full_name}
                </div>
              </td>
              <td style={tdRight}>{agent.assigned}</td>
              <td style={tdRight}>{agent.actioned}</td>
              <td style={tdRight}>{agent.confirmed}</td>
              <td style={tdRight}>{agent.rejected}</td>
              <td style={tdRight}>{agent.confirmation_rate.toFixed(1)}%</td>
              <td style={tdRight}>{agent.avg_attempts.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PeriodSelector({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  type TabKey = "today" | "week" | "month" | "last7" | "last30" | "custom";
  const [activeTab, setActiveTab] = useState<TabKey>("today");

  function getToday(): Period {
    const d = new Date().toISOString().slice(0, 10);
    return { from_date: d, to_date: d };
  }

  function getThisWeek(): Period {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return {
      from_date: monday.toISOString().slice(0, 10),
      to_date: now.toISOString().slice(0, 10),
    };
  }

  function getThisMonth(): Period {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      from_date: first.toISOString().slice(0, 10),
      to_date: now.toISOString().slice(0, 10),
    };
  }

  function selectTab(tab: TabKey) {
    setActiveTab(tab);
    if (tab === "today") onChange(getToday());
    else if (tab === "week") onChange(getThisWeek());
    else if (tab === "month") onChange(getThisMonth());
    else if (tab === "last7") onChange(lastNDaysPeriod(7));
    else if (tab === "last30") onChange(lastNDaysPeriod(30));
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "today", label: "Aujourd'hui" },
    { key: "week", label: "Cette semaine" },
    { key: "month", label: "Ce mois" },
    { key: "last7", label: "7 derniers jours" },
    { key: "last30", label: "30 derniers jours" },
    { key: "custom", label: "Personnalisé" },
  ];

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0, borderBottom: "1px solid #D1D5DB" }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => selectTab(tab.key)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              color: activeTab === tab.key ? "#1A1A1A" : "#6D7175",
              background: "none",
              border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #1A1A1A" : "2px solid transparent",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "custom" && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <label style={{ fontSize: 13, color: "#1A1A1A" }}>
            Du :{" "}
            <input
              type="date"
              value={period.from_date}
              onChange={(e) => onChange({ ...period, from_date: e.target.value })}
              style={{
                marginLeft: 4,
                fontSize: 13,
                border: "1px solid #D1D5DB",
                borderRadius: "0.25rem",
                padding: "4px 8px",
                color: "#1A1A1A",
              }}
            />
          </label>
          <label style={{ fontSize: 13, color: "#1A1A1A" }}>
            Au :{" "}
            <input
              type="date"
              value={period.to_date}
              onChange={(e) => onChange({ ...period, to_date: e.target.value })}
              style={{
                marginLeft: 4,
                fontSize: 13,
                border: "1px solid #D1D5DB",
                borderRadius: "0.25rem",
                padding: "4px 8px",
                color: "#1A1A1A",
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
