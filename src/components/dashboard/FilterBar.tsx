"use client";

import { useState, useMemo } from "react";
import { todayISO, startOfWeekISO, startOfMonthISO } from "@/lib/date";

export interface Period {
  from_date: string;
  to_date: string;
}

export type PeriodPreset = "today" | "week" | "month" | "custom";

interface Market {
  id: string;
  name: string;
  code?: string;
}

interface FilterBarProps {
  period: Period;
  activePreset: PeriodPreset;
  onPeriodChange: (p: Period, preset: PeriodPreset) => void;

  markets: Market[];
  selectedMarketId: string | "all" | null;
  onMarketChange: (id: string | "all") => void;
  allowAllMarkets: boolean;
  /** When true, market chip is rendered as a locked read-only badge. */
  lockMarket: boolean;
  lockedMarketLabel: string;

  labels: {
    today: string;
    week: string;
    month: string;
    custom: string;
    allMarkets: string;
    marketPlaceholder: string;
    lastUpdated: string;
  };
  lastUpdatedAt?: Date | null;
}


export function FilterBar({
  period,
  activePreset,
  onPeriodChange,
  markets,
  selectedMarketId,
  onMarketChange,
  allowAllMarkets,
  lockMarket,
  lockedMarketLabel,
  labels,
  lastUpdatedAt,
}: FilterBarProps) {
  const presets: { key: PeriodPreset; label: string }[] = [
    { key: "today", label: labels.today },
    { key: "week", label: labels.week },
    { key: "month", label: labels.month },
    { key: "custom", label: labels.custom },
  ];

  const handlePreset = (preset: PeriodPreset) => {
    if (preset === "today") onPeriodChange({ from_date: todayISO(), to_date: todayISO() }, "today");
    else if (preset === "week")
      onPeriodChange({ from_date: startOfWeekISO(), to_date: todayISO() }, "week");
    else if (preset === "month")
      onPeriodChange({ from_date: startOfMonthISO(), to_date: todayISO() }, "month");
    else onPeriodChange(period, "custom");
  };

  const lastUpdatedText = useMemo(() => {
    if (!lastUpdatedAt) return null;
    const diff = Math.round((Date.now() - lastUpdatedAt.getTime()) / 1000);
    if (diff < 60) return `${labels.lastUpdated} ${diff}s`;
    const mins = Math.floor(diff / 60);
    return `${labels.lastUpdated} ${mins}m`;
  }, [lastUpdatedAt, labels.lastUpdated]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <MarketChip
          markets={markets}
          selected={selectedMarketId}
          onChange={onMarketChange}
          allowAll={allowAllMarkets}
          locked={lockMarket}
          lockedLabel={lockedMarketLabel}
          allLabel={labels.allMarkets}
          placeholder={labels.marketPlaceholder}
        />
        {lastUpdatedText ? (
          <span style={{ fontSize: 12, color: "#6D7175" }}>· {lastUpdatedText}</span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <PresetSegmented
          presets={presets}
          active={activePreset}
          onSelect={handlePreset}
        />
        {activePreset === "custom" ? (
          <CustomRange
            period={period}
            onChange={(p) => onPeriodChange(p, "custom")}
          />
        ) : null}
      </div>
    </div>
  );
}

function PresetSegmented({
  presets,
  active,
  onSelect,
}: {
  presets: { key: PeriodPreset; label: string }[];
  active: PeriodPreset;
  onSelect: (k: PeriodPreset) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        border: "1px solid #E1E3E5",
        borderRadius: 9999,
        background: "#FFFFFF",
        padding: 2,
        gap: 2,
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
              padding: "6px 14px",
              border: "none",
              borderRadius: 9999,
              background: isActive ? "#1A1A1A" : "transparent",
              color: isActive ? "#FFFFFF" : "#1A1A1A",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "background-color 120ms ease, color 120ms ease",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function MarketChip({
  markets,
  selected,
  onChange,
  allowAll,
  locked,
  lockedLabel,
  allLabel,
  placeholder,
}: {
  markets: Market[];
  selected: string | "all" | null;
  onChange: (id: string | "all") => void;
  allowAll: boolean;
  locked: boolean;
  lockedLabel: string;
  allLabel: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  if (locked) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: "1px solid #E1E3E5",
          background: "#F2F2F2",
          color: "#6D7175",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {lockedLabel}
      </span>
    );
  }

  const selectedLabel =
    selected === "all"
      ? allLabel
      : markets.find((m) => m.id === selected)?.name ?? placeholder;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 9999,
          border: "1px solid #E1E3E5",
          background: "#FFFFFF",
          color: "#1A1A1A",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedLabel}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 6px)",
            background: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 180,
            zIndex: 10,
            padding: 4,
          }}
          onMouseLeave={() => setOpen(false)}
        >
          {allowAll ? (
            <MarketOption
              label={allLabel}
              selected={selected === "all"}
              onClick={() => {
                onChange("all");
                setOpen(false);
              }}
            />
          ) : null}
          {markets.map((m) => (
            <MarketOption
              key={m.id}
              label={m.name}
              selected={selected === m.id}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MarketOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "start",
        padding: "8px 10px",
        border: "none",
        borderRadius: 6,
        background: selected ? "#F2F2F2" : hover ? "#F7F7F7" : "transparent",
        color: "#1A1A1A",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function CustomRange({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input
        type="date"
        value={period.from_date}
        onChange={(e) => onChange({ ...period, from_date: e.target.value })}
        style={{
          padding: "4px 8px",
          border: "1px solid #D1D5DB",
          borderRadius: 6,
          fontSize: 13,
          color: "#1A1A1A",
        }}
      />
      <span style={{ color: "#6D7175", fontSize: 13 }}>→</span>
      <input
        type="date"
        value={period.to_date}
        onChange={(e) => onChange({ ...period, to_date: e.target.value })}
        style={{
          padding: "4px 8px",
          border: "1px solid #D1D5DB",
          borderRadius: 6,
          fontSize: 13,
          color: "#1A1A1A",
        }}
      />
    </div>
  );
}
