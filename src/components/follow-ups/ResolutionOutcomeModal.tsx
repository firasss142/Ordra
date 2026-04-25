"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LOST_REASONS, type ResolutionOutcome, type LostReason, type OrderFollowUpWithOrder } from "@/types/follow-up";

interface Props {
  open: boolean;
  followUp: OrderFollowUpWithOrder;
  marketCode: "TN" | "LY";
  locale: string;
  onClose: () => void;
  onResolved: (outcome: ResolutionOutcome, lostReason?: LostReason, lostNote?: string) => void;
}

export function ResolutionOutcomeModal({
  open,
  followUp,
  onClose,
  onResolved,
}: Props) {
  const t = useTranslations("crm.followUps");
  const [outcome, setOutcome] = useState<ResolutionOutcome | null>(null);
  const [lostReason, setLostReason] = useState<LostReason | null>(null);
  const [lostNote, setLostNote] = useState("");

  if (!open) return null;

  const canConfirm =
    outcome === "converted" || (outcome === "lost" && lostReason !== null);

  const handleConfirm = () => {
    if (!outcome) return;
    onResolved(
      outcome,
      outcome === "lost" ? (lostReason ?? undefined) : undefined,
      outcome === "lost" && lostNote.trim() ? lostNote.trim() : undefined
    );
  };

  const handleReset = () => {
    setOutcome(null);
    setLostReason(null);
    setLostNote("");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 10,
          padding: 24,
          width: 400,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Step 1: Choose outcome */}
        {!outcome && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={() => setOutcome("converted")}
              style={choiceStyle}
            >
              {t("outcomes.converted")}
            </button>
            <button
              type="button"
              onClick={() => setOutcome("lost")}
              style={{ ...choiceStyle, color: "#B91C1C", borderColor: "#FECACA" }}
            >
              {t("outcomes.lost")}
            </button>
          </div>
        )}

        {/* Step 2a: Converted — show customer info */}
        {outcome === "converted" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>{followUp.order.customer_name}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>{followUp.order.customer_phone}</span>
            </div>
            {followUp.order.customer_city && (
              <div style={infoRowStyle}>
                <span style={labelStyle}>{followUp.order.customer_city}</span>
              </div>
            )}
          </div>
        )}

        {/* Step 2b: Lost — reason selector */}
        {outcome === "lost" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#6D7175" }}>
              {t("lostReasonLabel")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {LOST_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setLostReason(r)}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: `1px solid ${lostReason === r ? "#1A1A1A" : "#E1E3E5"}`,
                    background: lostReason === r ? "#1A1A1A" : "white",
                    color: lostReason === r ? "white" : "#1A1A1A",
                    cursor: "pointer",
                  }}
                >
                  {t(`lostReasons.${r}`)}
                </button>
              ))}
            </div>
            {lostReason === "autre" && (
              <textarea
                value={lostNote}
                onChange={(e) => setLostNote(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "8px 10px",
                  border: "1px solid #E1E3E5",
                  borderRadius: 6,
                  resize: "vertical",
                  color: "#1A1A1A",
                }}
              />
            )}
          </div>
        )}

        {/* Footer buttons */}
        {outcome && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => { handleReset(); onClose(); }}
              style={cancelBtnStyle}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              style={{
                ...confirmBtnStyle,
                opacity: canConfirm ? 1 : 0.4,
                cursor: canConfirm ? "pointer" : "not-allowed",
              }}
            >
              {t("save")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const choiceStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  border: "1px solid #E1E3E5",
  background: "white",
  color: "#1A1A1A",
  cursor: "pointer",
  textAlign: "start",
};

const infoRowStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "#F6F6F7",
  borderRadius: 6,
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  color: "#1A1A1A",
};

const cancelBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #E1E3E5",
  background: "white",
  color: "#1A1A1A",
  cursor: "pointer",
};

const confirmBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  background: "#1A1A1A",
  color: "white",
};
