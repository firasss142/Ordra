"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Agent {
  id: string;
  full_name: string;
}

interface Props {
  selectedIds: string[];
  agents: Agent[];
  onClearSelection: () => void;
  onBulkAssign: (agentId: string) => Promise<void> | void;
  onBulkCancel: () => Promise<void> | void;
  canAssign: boolean;
  canCancel: boolean;
}

export function OrdersBulkBar({
  selectedIds,
  agents,
  onClearSelection,
  onBulkAssign,
  onBulkCancel,
  canAssign,
  canCancel,
}: Props) {
  const t = useTranslations("orders.bulk");
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (selectedIds.length === 0) return null;

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        insetInlineStart: "50%",
        transform: "translateX(-50%)",
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
        background: "#1A1A1A",
        color: "#FFFFFF",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 500,
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {t("selected", { count: selectedIds.length })}
      </span>

      {canAssign ? (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setAssignOpen((o) => !o)}
            disabled={busy}
            style={{
              height: 28,
              padding: "0 12px",
              background: "#2A2A2A",
              color: "#FFFFFF",
              border: "1px solid #3A3A3A",
              borderRadius: 6,
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {t("assign")} ▾
          </button>
          {assignOpen ? (
            <>
              <div
                aria-hidden
                onClick={() => setAssignOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 9 }}
              />
              <div
                role="listbox"
                style={{
                  position: "absolute",
                  insetInlineStart: 0,
                  top: "calc(100% + 6px)",
                  background: "#FFFFFF",
                  border: "1px solid #E1E3E5",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                  minWidth: 220,
                  maxHeight: 320,
                  overflowY: "auto",
                  zIndex: 10,
                  padding: 4,
                  color: "#1A1A1A",
                }}
              >
                {agents.length === 0 ? (
                  <div style={{ padding: 10, fontSize: 13, color: "#6D7175" }}>
                    {t("noAgents")}
                  </div>
                ) : (
                  agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={async () => {
                        setAssignOpen(false);
                        await run(() => onBulkAssign(a.id));
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "start",
                        padding: "8px 10px",
                        border: "none",
                        background: "transparent",
                        color: "#1A1A1A",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        borderRadius: 6,
                      }}
                      onMouseEnter={(e) => ((e.currentTarget.style.background = "#F7F7F7"))}
                      onMouseLeave={(e) => ((e.currentTarget.style.background = "transparent"))}
                    >
                      {a.full_name}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {canCancel ? (
        <button
          type="button"
          onClick={() => run(onBulkCancel)}
          disabled={busy}
          style={{
            height: 28,
            padding: "0 12px",
            background: "#D72C0D",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {t("cancel")}
        </button>
      ) : null}

      <button
        type="button"
        onClick={onClearSelection}
        disabled={busy}
        aria-label={t("clearSelection")}
        style={{
          marginInlineStart: "auto",
          background: "none",
          border: "none",
          color: "#C9CCCF",
          fontSize: 16,
          cursor: "pointer",
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
