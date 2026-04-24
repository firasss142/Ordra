"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Panel, EmptyState } from "./Panel";
import type { PresenceAgent } from "@/lib/dashboard/summary";

interface TopPerformersProps {
  agents: PresenceAgent[];
  title: string;
  confirmedLabel: string;
  onlineCountTemplate: (online: number, total: number) => string;
  viewAllHref: string;
  viewAllLabel: string;
  emptyLabel: string;
}

function sortTop(agents: PresenceAgent[]): PresenceAgent[] {
  return [...agents].sort((a, b) => {
    if (b.confirmation_rate !== a.confirmation_rate) return b.confirmation_rate - a.confirmation_rate;
    return b.confirmed_today - a.confirmed_today;
  });
}

export function TopPerformers({
  agents,
  title,
  confirmedLabel,
  onlineCountTemplate,
  viewAllHref,
  viewAllLabel,
  emptyLabel,
}: TopPerformersProps) {
  const top3 = useMemo(() => sortTop(agents).slice(0, 3), [agents]);
  const onlineCount = agents.filter((a) => a.state === "online").length;
  const total = agents.length;

  return (
    <Panel title={title} minHeight={280}>
      {top3.length === 0 ? (
        <EmptyState label={emptyLabel} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {top3.map((agent, idx) => (
            <div
              key={agent.agent_id}
              data-testid="top-performer-row"
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "8px 4px",
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: idx === 0 ? "#1A1A1A" : "#E1E3E5",
                  color: idx === 0 ? "#FFFFFF" : "#3D4043",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {idx + 1}
              </span>
              <Avatar
                user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
                size={28}
              />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span
                  style={{
                    color: "#1A1A1A",
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={agent.full_name}
                >
                  {agent.full_name}
                </span>
                <span style={{ fontSize: 12, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
                  {agent.confirmed_today} {confirmedLabel}
                </span>
              </div>
              <span
                style={{
                  color: "#1A1A1A",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {agent.confirmation_rate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid #E1E3E5",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          color: "#6D7175",
        }}
      >
        <span>{onlineCountTemplate(onlineCount, total)}</span>
        <a
          href={viewAllHref}
          style={{
            color: "#1A1A1A",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {viewAllLabel} <span aria-hidden="true">→</span>
        </a>
      </div>
    </Panel>
  );
}
