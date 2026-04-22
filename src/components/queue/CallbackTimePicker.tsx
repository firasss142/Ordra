"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface CallbackTimePickerProps {
  onSchedule: (callbackAt: string) => void;
  onCancel: () => void;
}

const inputStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.375rem",
  background: "white",
  color: "#1A1A1A",
  width: "100%",
};

const btnPrimary: React.CSSProperties = {
  height: 36,
  padding: "0 16px",
  fontSize: 14,
  fontWeight: 500,
  backgroundColor: "#1A1A1A",
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

function getDefaultCallbackTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 2);
  return d.toISOString().slice(0, 16);
}

export function CallbackTimePicker({
  onSchedule,
  onCancel,
}: CallbackTimePickerProps) {
  const t = useTranslations("queue");
  const [callbackTime, setCallbackTime] = useState("");
  useEffect(() => { setCallbackTime(getDefaultCallbackTime()); }, []);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label
          style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A", display: "block", marginBottom: 4 }}
        >
          {t("callbackTime")}
        </label>
        <input
          type="datetime-local"
          value={callbackTime}
          onChange={(e) => setCallbackTime(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btnSecondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          style={btnPrimary}
          onClick={() => onSchedule(new Date(callbackTime).toISOString())}
        >
          {t("scheduleCallback")}
        </button>
      </div>
    </div>
  );
}
