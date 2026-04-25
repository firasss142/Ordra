"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { AgentMetrics } from "@/lib/confirmation-flow/aggregations";
import { ReassignActionMenu } from "./ReassignActionMenu";

interface AgentStrugglingTableProps {
  agents: AgentMetrics[];
  marketId: string | null;
  onReassignDone: () => void;
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #E1E3E5",
  whiteSpace: "nowrap",
  textAlign: "start",
};

const tdStyle: React.CSSProperties = {
  padding: "11px 12px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #F0F0F0",
};

function formatMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins - h * 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function rowTint(
  inAttempt3: number,
  overdueCallbacks: number
): React.CSSProperties {
  const struggling = inAttempt3 >= 5 || overdueCallbacks >= 3;
  const critical = inAttempt3 >= 5 && overdueCallbacks >= 3;
  if (critical) {
    return { background: "#FFF0F0", borderInlineStart: "3px solid #D72C0D" };
  }
  if (struggling) {
    return { background: "#FFF8ED", borderInlineStart: "3px solid #B98900" };
  }
  return {};
}

type SortKey = "struggle" | "in_attempt_3" | "overdue_callbacks" | "ttfc_p50";

export function AgentStrugglingTable({
  agents,
  marketId,
  onReassignDone,
}: AgentStrugglingTableProps) {
  const t = useTranslations("confirmationFlow");
  const [sortKey, setSortKey] = useState<SortKey>("struggle");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    return [...agents].sort((a, b) => {
      let diff = 0;
      if (sortKey === "struggle") {
        diff =
          a.in_attempt_3 + a.overdue_callbacks - (b.in_attempt_3 + b.overdue_callbacks);
      } else if (sortKey === "in_attempt_3") {
        diff = a.in_attempt_3 - b.in_attempt_3;
      } else if (sortKey === "overdue_callbacks") {
        diff = a.overdue_callbacks - b.overdue_callbacks;
      } else if (sortKey === "ttfc_p50") {
        diff = (a.ttfc_p50_minutes ?? Infinity) - (b.ttfc_p50_minutes ?? Infinity);
      }
      return sortAsc ? diff : -diff;
    });
  }, [agents, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortAsc ? " ↑" : " ↓") : "");

  if (agents.length === 0) {
    return (
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          padding: 32,
          textAlign: "center",
          color: "#6D7175",
          fontSize: 13,
        }}
      >
        {t("table.empty")}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid #E1E3E5",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>
          {t("table.title")}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("table.agent")}</th>
              <th
                style={{ ...thStyle, cursor: "pointer" }}
                onClick={() => toggleSort("in_attempt_3")}
              >
                {t("table.inAttempt3")}{sortArrow("in_attempt_3")}
              </th>
              <th
                style={{ ...thStyle, cursor: "pointer" }}
                onClick={() => toggleSort("overdue_callbacks")}
              >
                {t("table.overdueCallbacks")}{sortArrow("overdue_callbacks")}
              </th>
              <th
                style={{ ...thStyle, cursor: "pointer" }}
                onClick={() => toggleSort("ttfc_p50")}
              >
                {t("table.ttfcP50")}{sortArrow("ttfc_p50")}
              </th>
              <th style={thStyle}>{t("table.ttfcP90")}</th>
              <th style={thStyle}>{t("table.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <tr key={agent.agent_id} style={rowTint(agent.in_attempt_3, agent.overdue_callbacks)}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{agent.full_name}</div>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      color: agent.in_attempt_3 >= 5 ? "#D72C0D" : "#1A1A1A",
                      fontWeight: agent.in_attempt_3 >= 5 ? 600 : 400,
                    }}
                  >
                    {agent.in_attempt_3}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      color: agent.overdue_callbacks >= 3 ? "#B98900" : "#1A1A1A",
                      fontWeight: agent.overdue_callbacks >= 3 ? 600 : 400,
                    }}
                  >
                    {agent.overdue_callbacks}
                  </span>
                </td>
                <td style={tdStyle}>{formatMinutes(agent.ttfc_p50_minutes)}</td>
                <td style={tdStyle}>{formatMinutes(agent.ttfc_p90_minutes)}</td>
                <td style={{ ...tdStyle, display: "flex", gap: 8, alignItems: "center" }}>
                  <ReassignActionMenu
                    agentId={agent.agent_id}
                    stuckOrderIds={agent.stuck_order_ids}
                    marketId={marketId}
                    onDone={onReassignDone}
                  />
                  <button
                    disabled
                    title={t("table.escalateTooltip")}
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      fontWeight: 500,
                      background: "#F9FAFB",
                      border: "1px solid #E1E3E5",
                      borderRadius: 4,
                      cursor: "not-allowed",
                      color: "#9CA3AF",
                    }}
                  >
                    {t("table.escalate")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
