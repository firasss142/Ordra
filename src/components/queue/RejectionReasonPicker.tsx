"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { REJECTION_REASONS } from "@/types/order-status";
import type { RejectionReason } from "@/types/order-status";

interface RejectionReasonPickerProps {
  onReject: (reason: RejectionReason, note?: string) => void;
  onCancel: () => void;
}

const selectStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.375rem",
  background: "white",
  color: "#1A1A1A",
  width: "100%",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.375rem",
  minHeight: 60,
  resize: "vertical" as const,
};

const btnPrimary: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 500,
  backgroundColor: "#DC2626",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "0.375rem",
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 500,
  backgroundColor: "white",
  color: "#1A1A1A",
  border: "1px solid #D1D5DB",
  borderRadius: "0.375rem",
  cursor: "pointer",
};

export function RejectionReasonPicker({
  onReject,
  onCancel,
}: RejectionReasonPickerProps) {
  const t = useTranslations("queue");
  const tOrders = useTranslations("orders");
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState("");

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label
          style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", display: "block", marginBottom: 4 }}
        >
          {t("selectReason")}
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as RejectionReason)}
          style={selectStyle}
        >
          <option value="">{t("selectReason")}</option>
          {REJECTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {tOrders(`rejectionReasons.${r}`)}
            </option>
          ))}
        </select>
      </div>

      {reason === "autre" && (
        <div style={{ marginBottom: 12 }}>
          <label
            style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", display: "block", marginBottom: 4 }}
          >
            {t("rejectionNote")}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={textareaStyle}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button style={btnSecondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          style={{
            ...btnPrimary,
            opacity: !reason ? 0.5 : 1,
            cursor: !reason ? "not-allowed" : "pointer",
          }}
          disabled={!reason}
          onClick={() => reason && onReject(reason, note || undefined)}
        >
          {t("rejectOrder")}
        </button>
      </div>
    </div>
  );
}
