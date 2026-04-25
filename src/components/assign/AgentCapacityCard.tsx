"use client";

import { useTranslations } from "next-intl";
import { Avatar } from "@/components/ui/Avatar";
import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";
import { derivePresence, type Presence } from "@/lib/assign/presence";

const PRESENCE_COLOR: Record<Presence, string> = {
  online: "#008060",
  idle: "#B98900",
  offline: "#6D7175",
};

interface Props {
  agent: AgentCapacityRow;
  selectedCount: number;
  onAssign: (agentId: string) => void;
  busy?: boolean;
  now?: Date;
}

export function AgentCapacityCard({
  agent,
  selectedCount,
  onAssign,
  busy = false,
  now = new Date(),
}: Props) {
  const t = useTranslations("assign");
  const presence = derivePresence(agent.last_seen_at, now);
  const ratePct = Math.round((agent.confirmation_rate ?? 0) * 100);
  const disabled = selectedCount === 0 || busy;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
      }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar user={agent} size={32} />
        <span
          aria-hidden
          title={t(`presence.${presence}`)}
          style={{
            position: "absolute",
            bottom: -1,
            insetInlineEnd: -1,
            width: 10,
            height: 10,
            borderRadius: 9999,
            background: PRESENCE_COLOR[presence],
            border: "2px solid #FFFFFF",
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#1A1A1A",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.full_name ?? "—"}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "#6D7175",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span title={t("agents.queue")}>{t("agents.queueShort", { count: agent.queue_size })}</span>
          <span title={t("agents.confirmationRate")}>
            {t("agents.rateShort", { pct: ratePct })}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAssign(agent.id)}
        disabled={disabled}
        style={{
          padding: "6px 12px",
          border: "1px solid #1A1A1A",
          borderRadius: 6,
          background: disabled ? "#F2F2F2" : "#1A1A1A",
          color: disabled ? "#6D7175" : "#FFFFFF",
          fontSize: 12,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        {t("agents.assignButton", { count: selectedCount })}
      </button>
    </div>
  );
}
