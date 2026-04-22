"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { PRESENCE_COLOR, type PresenceState } from "@/lib/presence";
import type { PresenceAgent } from "@/lib/dashboard/summary";

interface PresencePanelProps {
  agents: PresenceAgent[];
  title: string;
  onlineLabel: string;
  idleLabel: string;
  offlineLabel: string;
  queueLabel: string;
  emptyLabel: string;
  viewAllLabel: string;
  viewAllHref?: string;
}

// Sort: online > idle > offline, then by queue_size desc, then by confirmation_rate desc.
const STATE_ORDER: Record<PresenceState, number> = {
  online: 0,
  idle: 1,
  offline: 2,
};

function sortAgents(agents: PresenceAgent[]): PresenceAgent[] {
  return [...agents].sort((a, b) => {
    const s = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (s !== 0) return s;
    if (a.queue_size !== b.queue_size) return b.queue_size - a.queue_size;
    return b.confirmation_rate - a.confirmation_rate;
  });
}

export function PresencePanel({
  agents,
  title,
  onlineLabel,
  idleLabel,
  offlineLabel,
  queueLabel,
  emptyLabel,
  viewAllLabel,
  viewAllHref,
}: PresencePanelProps) {
  const sorted = useMemo(() => sortAgents(agents), [agents]);
  let onlineCount = 0, idleCount = 0, offlineCount = 0;
  for (const a of agents) {
    if (a.state === "online") onlineCount++;
    else if (a.state === "idle") idleCount++;
    else offlineCount++;
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 320,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: "1px solid #E1E3E5",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>{title}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            fontWeight: 500,
            color: "#6D7175",
          }}
        >
          <StateBadge state="online" label={`${onlineCount} ${onlineLabel}`} />
          <StateBadge state="idle" label={`${idleCount} ${idleLabel}`} />
          <StateBadge state="offline" label={`${offlineCount} ${offlineLabel}`} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          maxHeight: 360,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {sorted.length === 0 ? (
          <div
            style={{
              padding: "32px 18px",
              textAlign: "center",
              fontSize: 13,
              color: "#6D7175",
            }}
          >
            {emptyLabel}
          </div>
        ) : (
          sorted.map((a) => <AgentRow key={a.agent_id} agent={a} queueLabel={queueLabel} />)
        )}
      </div>

      {viewAllHref ? (
        <a
          href={viewAllHref}
          style={{
            padding: "12px 18px",
            borderTop: "1px solid #E1E3E5",
            color: "#1A1A1A",
            fontSize: 13,
            fontWeight: 500,
            textAlign: "end",
            textDecoration: "none",
          }}
        >
          {viewAllLabel} →
        </a>
      ) : null}
    </div>
  );
}

function StateBadge({ state, label }: { state: PresenceState; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          background: PRESENCE_COLOR[state],
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function AgentRow({ agent, queueLabel }: { agent: PresenceAgent; queueLabel: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 18px",
        fontSize: 13,
      }}
    >
      <Avatar
        user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
        size={28}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: PRESENCE_COLOR[agent.state],
            flexShrink: 0,
          }}
        />
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
      </div>
      <span
        style={{
          color: "#6D7175",
          fontVariantNumeric: "tabular-nums",
          fontSize: 12,
          minWidth: 80,
          textAlign: "end",
        }}
      >
        {agent.queue_size} {queueLabel}
      </span>
      <span
        style={{
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          fontWeight: 500,
          minWidth: 52,
          textAlign: "end",
        }}
      >
        {agent.confirmation_rate.toFixed(1)}%
      </span>
    </div>
  );
}
