"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Globe, CalendarRange } from "lucide-react";
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
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
            <span style={{ fontSize: 12, color: MUTED }}>· {lastUpdatedText}</span>
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
        background: SUBTLE_BG,
        borderRadius: 8,
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
              padding: "5px 14px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: TEXT,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (locked) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: SUBTLE_BG,
          color: MUTED,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        <Globe size={13} strokeWidth={1.75} />
        {lockedLabel}
      </span>
    );
  }

  const selectedLabel =
    selected === "all"
      ? allLabel
      : markets.find((m) => m.id === selected)?.name ?? placeholder;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: SOFT_BG,
          color: TEXT,
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe size={13} strokeWidth={1.75} />
        {selectedLabel}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="listbox"
          style={{
            position: "absolute",
            insetInlineStart: 0,
            top: "calc(100% + 4px)",
            background: SOFT_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 200,
            zIndex: 10,
            padding: 4,
          }}
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
        color: TEXT,
        fontSize: 13,
        fontWeight: selected ? 600 : 500,
        cursor: "pointer",
        fontFamily: "inherit",
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
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 8px",
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
        background: SOFT_BG,
      }}
    >
      <CalendarRange size={13} strokeWidth={1.75} aria-hidden style={{ color: MUTED }} />
      <input
        type="date"
        value={period.from_date}
        onChange={(e) => onChange({ ...period, from_date: e.target.value })}
        style={{
          height: 24,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          fontSize: 13,
          color: TEXT,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      <span aria-hidden style={{ color: MUTED, fontSize: 13 }}>→</span>
      <input
        type="date"
        value={period.to_date}
        onChange={(e) => onChange({ ...period, to_date: e.target.value })}
        style={{
          height: 24,
          padding: "0 4px",
          border: "none",
          background: "transparent",
          fontSize: 13,
          color: TEXT,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}
