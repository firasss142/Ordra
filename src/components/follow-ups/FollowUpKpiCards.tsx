"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

interface Props {
  followUps: OrderFollowUpWithOrder[];
  isLoading?: boolean;
}

const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #E1E3E5",
  borderRadius: 8,
  padding: 16,
};

const kpiLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#6B7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  fontWeight: 500,
};

const kpiValue: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "#1A1A1A",
  marginTop: 4,
  fontVariantNumeric: "tabular-nums",
};

export function FollowUpKpiCards({ followUps, isLoading }: Props) {
  const t = useTranslations("crm.followUps.metrics");

  const counts = React.useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let resolved = 0;
    let escalated = 0;
    for (const f of followUps) {
      if (f.status === "open") open++;
      else if (f.status === "in_progress") inProgress++;
      else if (f.status === "resolved") resolved++;
      else if (f.status === "escalated") escalated++;
    }
    return { open, inProgress, resolved, escalated, total: followUps.length };
  }, [followUps]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#1A1A1A" }}>
        {t("title")}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
        }}
      >
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("total")}</div>
          <div style={kpiValue}>{isLoading ? "…" : counts.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("open")}</div>
          <div style={kpiValue}>{isLoading ? "…" : counts.open}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("inProgress")}</div>
          <div style={kpiValue}>{isLoading ? "…" : counts.inProgress}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("resolved")}</div>
          <div style={kpiValue}>{isLoading ? "…" : counts.resolved}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("escalated")}</div>
          <div style={kpiValue}>{isLoading ? "…" : counts.escalated}</div>
        </div>
      </div>
    </div>
  );
}
