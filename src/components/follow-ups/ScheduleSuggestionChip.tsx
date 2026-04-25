"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { suggestNextContact, suggestDurationLabel } from "@/lib/follow-ups/schedule";
import type { ContactOutcome } from "@/types/follow-up";

interface Props {
  outcome: ContactOutcome;
  onAccept: (suggestedDate: Date) => void;
  onSkip: () => void;
  nowMs?: number;
}

export function ScheduleSuggestionChip({
  outcome,
  onAccept,
  onSkip,
  nowMs = Date.now(),
}: Props) {
  const t = useTranslations("crm.followUps");
  const suggested = suggestNextContact(outcome, nowMs);
  const durationLabel = suggestDurationLabel(outcome);

  const [customDate, setCustomDate] = useState<string>(
    suggested ? toDatetimeLocalString(suggested) : ""
  );

  if (!suggested || !durationLabel) return null;

  const handleAccept = () => {
    const date = customDate ? new Date(customDate) : suggested;
    if (!isNaN(date.getTime())) {
      onAccept(date);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        background: "#F0FDF4",
        border: "1px solid #BBF7D0",
        borderRadius: 6,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 13, color: "#166534" }}>
        {t("scheduleSuggestion", { duration: durationLabel })}
      </span>
      <input
        type="datetime-local"
        value={customDate}
        onChange={(e) => setCustomDate(e.target.value)}
        style={{
          fontSize: 12,
          border: "1px solid #D1FAE5",
          borderRadius: 4,
          padding: "2px 6px",
          color: "#166534",
          background: "white",
        }}
      />
      <button
        type="button"
        onClick={handleAccept}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 10px",
          borderRadius: 4,
          border: "none",
          background: "#16A34A",
          color: "white",
          cursor: "pointer",
        }}
      >
        {t("acceptSchedule")}
      </button>
      <button
        type="button"
        onClick={onSkip}
        style={{
          fontSize: 12,
          padding: "4px 10px",
          borderRadius: 4,
          border: "1px solid #BBF7D0",
          background: "transparent",
          color: "#166534",
          cursor: "pointer",
        }}
      >
        {t("skipSchedule")}
      </button>
    </div>
  );
}

function toDatetimeLocalString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
