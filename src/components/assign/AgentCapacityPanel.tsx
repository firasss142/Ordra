"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";
import { derivePresence, PRESENCE_ORDER } from "@/lib/assign/presence";
import { AgentCapacityCard } from "./AgentCapacityCard";

interface Props {
  agents: AgentCapacityRow[];
  selectedCount: number;
  onAssign: (agentId: string) => void;
  busyAgentId?: string | null;
  loading?: boolean;
  fullWidth?: boolean;
}

export function AgentCapacityPanel({
  agents,
  selectedCount,
  onAssign,
  busyAgentId,
  loading = false,
  fullWidth = false,
}: Props) {
  const t = useTranslations("assign.agents");

  const sorted = useMemo(() => {
    const now = new Date();
    return [...agents].sort((a, b) => {
      const pA = PRESENCE_ORDER[derivePresence(a.last_seen_at, now)];
      const pB = PRESENCE_ORDER[derivePresence(b.last_seen_at, now)];
      if (pA !== pB) return pA - pB;
      return a.queue_size - b.queue_size;
    });
  }, [agents]);

  return (
    <aside
      aria-label={t("title")}
      style={{
        width: fullWidth ? "100%" : 320,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#1A1A1A" }}>
          {t("title")}
        </h2>
        <span style={{ fontSize: 12, color: "#6D7175" }}>{t("help")}</span>
      </header>
      {loading ? (
        <div style={{ fontSize: 13, color: "#6D7175", padding: 12 }}>{t("loading")}</div>
      ) : sorted.length === 0 ? (
        <div style={{ fontSize: 13, color: "#6D7175", padding: 12 }}>{t("empty")}</div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: fullWidth ? "repeat(auto-fill, minmax(260px, 1fr))" : "1fr",
          gap: 8,
        }}>
          {sorted.map((a) => (
            <AgentCapacityCard
              key={a.id}
              agent={a}
              selectedCount={selectedCount}
              onAssign={onAssign}
              busy={busyAgentId === a.id}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
