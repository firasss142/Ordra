"use client";

import type { ReactNode } from "react";
import { TONE_COLOR, type Tone } from "./kpiDelta";

interface KpiCardProps {
  label: string;
  value: string;
  /**
   * Delta line. Provide a pre-formatted string (e.g. "+8.2%" or "-0.4 pp").
   * tone controls the color.
   */
  deltaText?: string | null;
  deltaTone?: Tone;
  /**
   * Subtitle sits below value when no chart/delta is used (e.g. "3 en ligne · 2 inactifs").
   */
  subtitle?: string | null;
  /**
   * Optional slot for a sparkline or mini visual (rendered full-width, 48px tall).
   */
  visual?: ReactNode;
  /**
   * When true, value color is muted — used for agentsOnline type cards that aren't a single number.
   */
  muted?: boolean;
}

export function KpiCard({
  label,
  value,
  deltaText,
  deltaTone = "neutral",
  subtitle,
  visual,
  muted,
}: KpiCardProps) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: 124,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: muted ? "#6D7175" : "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {visual ? (
        <div style={{ height: 40, marginTop: "auto" }}>{visual}</div>
      ) : null}
      {deltaText ? (
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: TONE_COLOR[deltaTone],
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {deltaText}
        </div>
      ) : subtitle ? (
        <div style={{ fontSize: 13, fontWeight: 500, color: "#6D7175" }}>{subtitle}</div>
      ) : null}
    </div>
  );
}
