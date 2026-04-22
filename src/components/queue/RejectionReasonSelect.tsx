"use client";

import { useState } from "react";
import { REJECTION_REASONS } from "@/types/order-status";

const LABELS: Record<string, string> = {
  refus_client: "Refus client",
  faux_numero: "Faux numéro",
  doublon: "Doublon",
  injoignable: "Injoignable",
  prix: "Prix",
  non_serieux: "Non sérieux",
  autre: "Autre",
};

interface RejectionReasonSelectProps {
  onSelect: (reason: string, note?: string) => void;
  defaultReason?: string;
}

const rowBase: React.CSSProperties = {
  padding: "12px 16px",
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  color: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  userSelect: "none",
};

const rowSelected: React.CSSProperties = {
  ...rowBase,
  border: "2px solid #1A1A1A",
  borderWidth: "2px",
};

export function RejectionReasonSelect({ onSelect, defaultReason }: RejectionReasonSelectProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(defaultReason ?? null);
  const [note, setNote] = useState("");

  function handleReasonClick(reason: string) {
    setSelectedReason(reason);
    setNote("");
    onSelect(reason, undefined);
  }

  function handleNoteChange(value: string) {
    setNote(value);
    if (selectedReason) {
      onSelect(selectedReason, value || undefined);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {REJECTION_REASONS.map((reason) => (
          <div
            key={reason}
            style={selectedReason === reason ? rowSelected : rowBase}
            onClick={() => handleReasonClick(reason)}
          >
            {LABELS[reason] ?? reason}
          </div>
        ))}
      </div>

      {selectedReason === "autre" && (
        <div style={{ marginTop: 12 }}>
          <input
            type="text"
            placeholder="Précisez…"
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: 14,
              border: "1px solid #D1D5DB",
              borderRadius: "0.25rem",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}
    </div>
  );
}
