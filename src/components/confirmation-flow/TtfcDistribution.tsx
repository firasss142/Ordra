"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { TtfcDistribution as TtfcDistributionData } from "@/lib/confirmation-flow/aggregations";
import type { AgentMetrics } from "@/lib/confirmation-flow/aggregations";

const BarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false }
);

interface TtfcDistributionProps {
  distribution: TtfcDistributionData;
  agents: AgentMetrics[];
}

const BUCKET_LABELS = ["0-5m", "5-15m", "15-30m", "30-60m", "1-2h", "2-4h", "4-8h", "8-24h", "24h+"];

export function TtfcDistribution({ distribution, agents }: TtfcDistributionProps) {
  const t = useTranslations("confirmationFlow");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");

  const counts =
    selectedAgent === "all"
      ? distribution.counts_total
      : (distribution.counts_by_agent[selectedAgent] ?? distribution.counts_total.map(() => 0));

  const chartData = BUCKET_LABELS.map((label, i) => ({
    label,
    count: counts[i] ?? 0,
  }));

  const totalSamples = counts.reduce((a, b) => a + b, 0);

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "20px 24px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>
            {t("ttfc.title")}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175" }}>
            {t("ttfc.subtitle")} · {totalSamples} {t("ttfc.samples")}
          </div>
        </div>

        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          style={{
            padding: "5px 10px",
            fontSize: 12,
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            background: "#FFFFFF",
            color: "#1A1A1A",
            cursor: "pointer",
          }}
        >
          <option value="all">{t("ttfc.allAgents")}</option>
          {agents.map((a) => (
            <option key={a.agent_id} value={a.agent_id}>
              {a.full_name}
            </option>
          ))}
        </select>
      </div>

      {totalSamples === 0 ? (
        <div style={{ padding: "24px 0", color: "#6D7175", fontSize: 12, textAlign: "center" }}>
          {t("ttfc.empty")}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -8 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#6D7175" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6D7175" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as { label: string; count: number };
                return (
                  <div
                    style={{
                      background: "#1A1A1A",
                      color: "#FFFFFF",
                      padding: "6px 10px",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {d.label}: {d.count} {t("ttfc.orders")}
                  </div>
                );
              }}
            />
            <Bar dataKey="count" fill="#2C6ECB" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
