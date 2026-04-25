"use client";

import { useTranslations } from "next-intl";
import type { Period } from "@/components/dashboard/FilterBar";

export type TeamPeriodPreset = "yesterday" | "7d" | "30d" | "custom";

interface TeamPeriodSelectorProps {
  period: Period;
  activePreset: TeamPeriodPreset;
  onChange: (period: Period, preset: TeamPeriodPreset) => void;
}

function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 500,
  color: active ? "#1A1A1A" : "#6D7175",
  background: active ? "#FFFFFF" : "transparent",
  border: "1px solid",
  borderColor: active ? "#C9CCCF" : "transparent",
  borderRadius: 6,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  lineHeight: 1,
});

export function TeamPeriodSelector({ period, activePreset, onChange }: TeamPeriodSelectorProps) {
  const t = useTranslations("teamPerf.periods");
  const today = isoOffsetDays(0);
  const yesterday = isoOffsetDays(1);

  function select(preset: TeamPeriodPreset) {
    if (preset === "yesterday") {
      onChange({ from_date: yesterday, to_date: yesterday }, "yesterday");
    } else if (preset === "7d") {
      onChange({ from_date: isoOffsetDays(6), to_date: today }, "7d");
    } else if (preset === "30d") {
      onChange({ from_date: isoOffsetDays(29), to_date: today }, "30d");
    } else {
      onChange(period, "custom");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {(["yesterday", "7d", "30d", "custom"] as TeamPeriodPreset[]).map((preset) => (
        <button
          key={preset}
          type="button"
          style={tabStyle(activePreset === preset)}
          onClick={() => select(preset)}
        >
          {t(preset)}
        </button>
      ))}

      {activePreset === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginInlineStart: 8 }}>
          <label style={{ fontSize: 13, color: "#6D7175" }}>{t("from")}</label>
          <input
            type="date"
            value={period.from_date}
            max={period.to_date}
            onChange={(e) => onChange({ ...period, from_date: e.target.value }, "custom")}
            style={{
              fontSize: 13,
              padding: "4px 8px",
              border: "1px solid #C9CCCF",
              borderRadius: 6,
              color: "#1A1A1A",
            }}
          />
          <label style={{ fontSize: 13, color: "#6D7175" }}>{t("to")}</label>
          <input
            type="date"
            value={period.to_date}
            min={period.from_date}
            max={today}
            onChange={(e) => onChange({ ...period, to_date: e.target.value }, "custom")}
            style={{
              fontSize: 13,
              padding: "4px 8px",
              border: "1px solid #C9CCCF",
              borderRadius: 6,
              color: "#1A1A1A",
            }}
          />
        </div>
      )}
    </div>
  );
}
