"use client";

import { CalendarRange } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { todayISO, lastNDaysPeriod } from "@/lib/date";

export interface Period {
  from_date: string;
  to_date: string;
}

export type PeriodPreset = "today" | "week" | "month" | "custom";

interface FilterBarProps {
  period: Period;
  activePreset: PeriodPreset;
  onPeriodChange: (p: Period, preset: PeriodPreset) => void;

  labels: {
    today: string;
    week: string;
    month: string;
    custom: string;
  };
}

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

export function FilterBar({
  period,
  activePreset,
  onPeriodChange,
  labels,
}: FilterBarProps) {
  const isMobile = useIsMobile();
  const presets: { key: PeriodPreset; label: string }[] = [
    { key: "today", label: labels.today },
    { key: "week", label: labels.week },
    { key: "month", label: labels.month },
    { key: "custom", label: labels.custom },
  ];

  const handlePreset = (preset: PeriodPreset) => {
    if (preset === "today") onPeriodChange({ from_date: todayISO(), to_date: todayISO() }, "today");
    else if (preset === "week")
      onPeriodChange(lastNDaysPeriod(7), "week");
    else if (preset === "month")
      onPeriodChange(lastNDaysPeriod(30), "month");
    else onPeriodChange(period, "custom");
  };

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          flexWrap: isMobile ? undefined : "wrap",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 8 : 10,
          justifyContent: isMobile ? undefined : "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <PresetSegmented
            presets={presets}
            active={activePreset}
            onSelect={handlePreset}
            compact={isMobile}
          />
          {activePreset === "custom" ? (
            <CustomRange
              period={period}
              onChange={(p) => onPeriodChange(p, "custom")}
              compact={isMobile}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PresetSegmented({
  presets,
  active,
  onSelect,
  compact,
}: {
  presets: { key: PeriodPreset; label: string }[];
  active: PeriodPreset;
  onSelect: (k: PeriodPreset) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: compact ? "grid" : "inline-flex",
        gridTemplateColumns: compact ? "repeat(4, 1fr)" : undefined,
        width: compact ? "100%" : undefined,
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
      }}
    >
      {presets.map((p) => {
        const isActive = active === p.key;
        return (
          <button
            type="button"
            key={p.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(p.key)}
            style={{
              padding: compact ? "6px 4px" : "5px 14px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: TEXT,
              fontSize: compact ? 12 : 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function CustomRange({
  period,
  onChange,
  compact,
}: {
  period: Period;
  onChange: (p: Period) => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: compact ? "wrap" : undefined,
        alignItems: "center",
        gap: 6,
        minHeight: 30,
        padding: "4px 8px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: SOFT_BG,
        width: compact ? "100%" : undefined,
      }}
    >
      <CalendarRange size={13} strokeWidth={1.75} aria-hidden style={{ color: MUTED }} />
      <input
        type="date"
        value={period.from_date}
        onChange={(e) => onChange({ ...period, from_date: e.target.value })}
        style={{
          flex: compact ? 1 : undefined,
          height: 24,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          fontSize: 13,
          color: TEXT,
          outline: "none",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      />
      <span aria-hidden style={{ color: MUTED, fontSize: 13 }}>→</span>
      <input
        type="date"
        value={period.to_date}
        onChange={(e) => onChange({ ...period, to_date: e.target.value })}
        style={{
          flex: compact ? 1 : undefined,
          height: 24,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          fontSize: 13,
          color: TEXT,
          outline: "none",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      />
    </div>
  );
}
