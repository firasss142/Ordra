"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import type { FunnelStageData } from "@/hooks/useConfirmationFlowOverview";

const BarChart = dynamic(
  () => import("recharts").then((m) => m.BarChart),
  { ssr: false }
);
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false }
);

interface FunnelChartProps {
  funnel: FunnelStageData[];
  marketId: string;
}

const STAGE_COLORS: Record<string, string> = {
  assigned: "#2C6ECB",
  attempt_1: "#4A7FC1",
  attempt_2: "#B98900",
  attempt_3: "#D72C0D",
  callback_scheduled: "#6D7175",
};

function formatMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins - h * 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function FunnelChart({ funnel, marketId }: FunnelChartProps) {
  const t = useTranslations("confirmationFlow");
  const router = useRouter();
  const locale = useLocale();

  const chartData = funnel.map((f) => ({
    stage: t(`stages.${f.stage}`),
    stageKey: f.stage,
    open_count: f.open_count,
    entered_count: f.entered_count,
    avg_time: f.avg_time_in_stage_minutes,
    drop_off: f.drop_off_rate_pct,
  }));

  function handleClick(data: unknown) {
    const d = data as { activePayload?: Array<{ payload: { stageKey: string } }> } | null;
    const stageKey = d?.activePayload?.[0]?.payload?.stageKey;
    if (!stageKey) return;
    router.push(`/${locale}/orders?status=${stageKey}&market_id=${marketId}`);
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        borderRadius: 8,
        border: "1px solid #E1E3E5",
        padding: "20px 24px",
        flex: 1,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#1A1A1A",
          marginBottom: 4,
        }}
      >
        {t("funnel.title")}
      </div>
      <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 16 }}>
        {t("funnel.subtitle")}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 32, bottom: 0, left: 0 }}
          onClick={handleClick}
          style={{ cursor: "pointer" }}
        >
          <XAxis type="number" tick={{ fontSize: 11, fill: "#6D7175" }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fontSize: 12, fill: "#1A1A1A" }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof chartData)[number];
              return (
                <div
                  style={{
                    background: "#1A1A1A",
                    color: "#FFFFFF",
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  <div>
                    <strong>{t("funnel.openNow")}</strong>: {d.open_count}
                  </div>
                  <div>
                    <strong>{t("funnel.enteredWindow")}</strong>: {d.entered_count}
                  </div>
                  <div>
                    <strong>{t("funnel.avgTime")}</strong>: {formatMinutes(d.avg_time)}
                  </div>
                  {d.drop_off !== null && (
                    <div>
                      <strong>{t("funnel.dropOff")}</strong>: {d.drop_off}%
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="open_count"
            radius={[0, 4, 4, 0]}
            fill="#2C6ECB"
            label={{ position: "right", fontSize: 11, fill: "#6D7175" }}
            // Per-bar color based on stage
            // recharts Bar accepts Cell for per-bar customization; using a
            // single color here for simplicity — enough for v1.
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Drop-off legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 12 }}>
        {funnel
          .filter((f) => f.drop_off_rate_pct !== null)
          .map((f) => (
            <span key={f.stage} style={{ fontSize: 11, color: "#6D7175" }}>
              {t(`stages.${f.stage}`)}: -{f.drop_off_rate_pct}%
            </span>
          ))}
      </div>
    </div>
  );
}
