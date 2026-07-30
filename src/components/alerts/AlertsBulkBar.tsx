"use client";

import { BellOff, CheckCircle2, Clock, UsersRound, X } from "lucide-react";
import type { AlertsAgent } from "./constants";
import type { AlertsTranslator } from "./format";

function darkBarButton(busy: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    background: "#2A2A2A",
    border: "1px solid #333333",
    color: "#FFFFFF",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 500,
    cursor: busy ? "progress" : "pointer",
    opacity: busy ? 0.7 : 1,
  };
}

export function AlertsBulkBar({
  count,
  canReassign,
  onClear,
  onAck,
  onSnooze,
  onReassign,
  busy,
  agentPickerOpen,
  onCloseAgentPicker,
  agents,
  onPickAgent,
  t,
}: {
  count: number;
  canReassign: boolean;
  onClear: () => void;
  onAck: () => void;
  onSnooze: (minutes: number) => void;
  onReassign: () => void;
  busy: "ack" | "snooze" | "reassign" | null;
  agentPickerOpen: boolean;
  onCloseAgentPicker: () => void;
  agents: AlertsAgent[];
  onPickAgent: (agentId: string) => void;
  t: AlertsTranslator;
}) {
  return (
    <div
      style={{
        background: "#1A1A1A",
        color: "#FFFFFF",
        borderRadius: 8,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        onClick={onClear}
        aria-label={t("clearSelection")}
        style={{
          background: "transparent",
          border: "none",
          color: "#FFFFFF",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
        }}
      >
        <X size={14} strokeWidth={1.75} />
      </button>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{t("selectedCount", { count })}</span>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={onAck} disabled={busy !== null} style={darkBarButton(busy === "ack")}>
        <CheckCircle2 size={13} strokeWidth={1.75} />
        <span style={{ marginInlineStart: 6 }}>{t("actions.acknowledge")}</span>
      </button>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => onSnooze(60)}
          disabled={busy !== null}
          style={darkBarButton(busy === "snooze")}
          title={t("actions.snooze1h")}
        >
          <BellOff size={13} strokeWidth={1.75} />
          <span style={{ marginInlineStart: 6 }}>{t("actions.snooze1h")}</span>
        </button>
      </div>
      <button
        type="button"
        onClick={() => onSnooze(60 * 24)}
        disabled={busy !== null}
        style={darkBarButton(false)}
        title={t("actions.snooze1d")}
      >
        <Clock size={13} strokeWidth={1.75} />
        <span style={{ marginInlineStart: 6 }}>{t("actions.snooze1d")}</span>
      </button>
      {canReassign && (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={onReassign}
            disabled={busy !== null}
            style={darkBarButton(busy === "reassign")}
          >
            <UsersRound size={13} strokeWidth={1.75} />
            <span style={{ marginInlineStart: 6 }}>{t("actions.reassign")}</span>
          </button>
          {agentPickerOpen && (
            <div
              style={{
                position: "absolute",
                insetInlineEnd: 0,
                top: "calc(100% + 4px)",
                background: "#FFFFFF",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                padding: 6,
                minWidth: 220,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 10,
              }}
              onBlur={onCloseAgentPicker}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 6px 6px",
                  borderBlockEnd: "1px solid #F2F2F2",
                  marginBlockEnd: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1A1A" }}>{t("pickAgent")}</span>
                <button
                  type="button"
                  onClick={onCloseAgentPicker}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#6D7175",
                    padding: 2,
                    display: "flex",
                    alignItems: "center",
                  }}
                  aria-label={t("close")}
                >
                  <X size={12} strokeWidth={1.75} />
                </button>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflow: "auto" }}>
                {agents.length === 0 ? (
                  <li style={{ padding: "8px 6px", fontSize: 12, color: "#6D7175" }}>{t("noAgents")}</li>
                ) : (
                  agents.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onPickAgent(a.id)}
                        style={{
                          width: "100%",
                          textAlign: "start",
                          padding: "8px 10px",
                          background: "transparent",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontSize: 13,
                          color: "#1A1A1A",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#F7F7F7")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        {a.full_name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
