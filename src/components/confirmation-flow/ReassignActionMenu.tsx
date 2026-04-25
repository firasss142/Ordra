"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ReassignControls } from "@/components/team/ReassignControls";

interface ReassignActionMenuProps {
  agentId: string;
  stuckOrderIds: string[];
  marketId: string | null;
  onDone: () => void;
}

export function ReassignActionMenu({
  agentId,
  stuckOrderIds,
  marketId,
  onDone,
}: ReassignActionMenuProps) {
  const t = useTranslations("confirmationFlow");
  const [open, setOpen] = useState(false);

  if (stuckOrderIds.length === 0) return null;

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 500,
          background: "#F3F4F6",
          border: "1px solid #D1D5DB",
          borderRadius: 4,
          cursor: "pointer",
          color: "#1A1A1A",
        }}
      >
        {t("table.reassign")} ({stuckOrderIds.length})
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            insetInlineStart: 0,
            marginTop: 4,
            background: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            padding: 16,
            zIndex: 20,
            minWidth: 280,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <ReassignControls
            selectedOrderIds={stuckOrderIds}
            currentAgentId={agentId}
            marketId={marketId}
            onDone={() => {
              setOpen(false);
              onDone();
            }}
          />
        </div>
      )}
    </div>
  );
}
