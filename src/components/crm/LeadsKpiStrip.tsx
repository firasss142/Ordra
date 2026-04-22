"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { KpiCard } from "@/components/dashboard/KpiCard";
import type { LeadsMetrics } from "@/lib/leads/metrics";

interface Props {
  metrics: LeadsMetrics;
}

const ACTIVE_STATUSES = [
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "qualified",
] as const;

export function LeadsKpiStrip({ metrics }: Props) {
  const t = useTranslations("crm.leads.metrics");

  const activePipeline = useMemo(
    () => ACTIVE_STATUSES.reduce((sum, s) => sum + (metrics.byStatus[s] ?? 0), 0),
    [metrics.byStatus],
  );

  const denom = metrics.won + metrics.lost;
  const conversionValue =
    denom === 0 ? t("empty") : `${Math.round(metrics.overallConversionRate * 100)}%`;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard label={t("activePipeline")} value={String(activePipeline)} />
      <KpiCard
        label={t("callbacksToday")}
        value={String(metrics.callbacksDueToday)}
      />
      <KpiCard
        label={t("qualified")}
        value={String(metrics.byStatus.qualified ?? 0)}
      />
      <KpiCard
        label={t("won")}
        value={String(metrics.won)}
        deltaTone="success"
      />
      <KpiCard
        label={t("conversionRate")}
        value={conversionValue}
        deltaTone="success"
      />
    </div>
  );
}
