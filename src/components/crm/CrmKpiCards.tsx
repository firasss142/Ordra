"use client";

import React from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { CrmMetricsResponse } from "@/app/api/leads/metrics/route";

interface Props {
  marketId: string | null;
  isSuperAdmin: boolean;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("Failed to load CRM metrics");
    return r.json();
  });

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

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#1A1A1A",
  marginBottom: 12,
};

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "start",
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #F3F4F6",
  fontVariantNumeric: "tabular-nums",
};

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function CrmKpiCards({ marketId, isSuperAdmin }: Props) {
  const t = useTranslations("crm.metrics");
  const tSources = useTranslations("crm.leads.sources");
  const tReasons = useTranslations("crm.leads.lostReasons");

  const url =
    isSuperAdmin && marketId
      ? `/api/leads/metrics?market_id=${marketId}`
      : "/api/leads/metrics";

  const { data, error, isLoading } = useSWR<{ data: CrmMetricsResponse }>(
    url,
    fetcher
  );

  if (error) {
    return <div style={{ color: "#DC2626", padding: 16 }}>{error.message}</div>;
  }
  if (isLoading || !data?.data) {
    return <div style={{ color: "#6B7280", padding: 16 }}>…</div>;
  }

  const m = data.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: "#1A1A1A" }}>
        {t("title")}
      </div>

      {/* Summary row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("totalLeads")}</div>
          <div style={kpiValue}>{m.total}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("won")}</div>
          <div style={kpiValue}>{m.won}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("lost")}</div>
          <div style={kpiValue}>{m.lost}</div>
        </div>
        <div style={cardStyle}>
          <div style={kpiLabel}>{t("conversionRate")}</div>
          <div style={kpiValue}>{formatPct(m.overallConversionRate)}</div>
        </div>
      </div>

      {/* Breakdowns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div style={cardStyle}>
          <div style={sectionTitle}>{t("byAgent")}</div>
          {m.byAgent.length === 0 ? (
            <div style={{ color: "#6B7280", fontSize: 13 }}>{t("noData")}</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("agent")}</th>
                  <th style={thStyle}>{t("total")}</th>
                  <th style={thStyle}>{t("won")}</th>
                  <th style={thStyle}>{t("conversionRate")}</th>
                </tr>
              </thead>
              <tbody>
                {m.byAgent.map((a) => (
                  <tr key={a.agentId}>
                    <td style={tdStyle}>{a.agentName}</td>
                    <td style={tdStyle}>{a.total}</td>
                    <td style={tdStyle}>{a.won}</td>
                    <td style={tdStyle}>{formatPct(a.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={cardStyle}>
          <div style={sectionTitle}>{t("bySource")}</div>
          {m.bySource.length === 0 ? (
            <div style={{ color: "#6B7280", fontSize: 13 }}>{t("noData")}</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("bySource")}</th>
                  <th style={thStyle}>{t("total")}</th>
                  <th style={thStyle}>{t("won")}</th>
                  <th style={thStyle}>{t("conversionRate")}</th>
                </tr>
              </thead>
              <tbody>
                {m.bySource.map((s) => (
                  <tr key={s.source}>
                    <td style={tdStyle}>{tSources(s.source)}</td>
                    <td style={tdStyle}>{s.total}</td>
                    <td style={tdStyle}>{s.won}</td>
                    <td style={tdStyle}>{formatPct(s.conversionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionTitle}>{t("lostReasons")}</div>
        {m.lostReasons.length === 0 ? (
          <div style={{ color: "#6B7280", fontSize: 13 }}>{t("noData")}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("lostReasons")}</th>
                <th style={thStyle}>{t("count")}</th>
              </tr>
            </thead>
            <tbody>
              {m.lostReasons.map((r) => (
                <tr key={r.reason}>
                  <td style={tdStyle}>{tReasons(r.reason)}</td>
                  <td style={tdStyle}>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
