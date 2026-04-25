"use client";

import { useTranslations } from "next-intl";
import { getDueUrgency, type DueUrgency } from "@/types/follow-up";
import { classifyDueTime } from "@/lib/format";

interface Props {
  dueAt: string | null;
  nowMs?: number;
  locale: string;
}

const STYLES: Record<Exclude<DueUrgency, "no_schedule">, React.CSSProperties> = {
  overdue: {
    background: "#FEE2E2",
    color: "#B91C1C",
    border: "1px solid #FECACA",
  },
  due_today: {
    background: "#FEF3C7",
    color: "#92400E",
    border: "1px solid #FDE68A",
  },
  due_future: {
    background: "#F3F4F6",
    color: "#6B7280",
    border: "1px solid #E5E7EB",
  },
};

export function DueUrgencyBadge({ dueAt, nowMs = Date.now(), locale }: Props) {
  const t = useTranslations("crm.followUps");
  const urgency = getDueUrgency(dueAt, nowMs);

  if (urgency === "no_schedule") return null;

  const classified = classifyDueTime(dueAt, nowMs, locale);
  const label = t(classified.key, classified.params);

  return (
    <span
      role="status"
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 500,
        borderRadius: 4,
        padding: "2px 6px",
        ...STYLES[urgency],
      }}
    >
      {label}
    </span>
  );
}
