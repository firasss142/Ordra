"use client";

import { Printer, ScanLine, Clock, PackageOpen } from "lucide-react";

const D = {
  pageBg: "#F6F6F7",
  cardBg: "#FFFFFF",
  border: "#E1E3E5",
  textPrimary: "#1A1A1A",
  textSecondary: "#6D7175",
  accent: "#008060",
  cardShadow: "0 0 0 1px #E1E3E5",
} as const;

interface Props {
  labelsPrintedToday: number;
  ordersScannedToday: number;
  avgCycleSeconds: number;
  traySize: number;
  labels: {
    labelsPrinted: string;
    ordersScanned: string;
    avgCycle: string;
    traySize: string;
  };
}

function formatCycle(secs: number): string {
  if (secs === 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}min` : `${m}min ${s}s`;
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function StatTile({ icon, label, value }: StatTileProps) {
  return (
    <div
      style={{
        backgroundColor: D.cardBg,
        border: `1px solid ${D.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ color: D.textSecondary, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: D.textSecondary,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginBottom: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: D.textPrimary,
            lineHeight: 1,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export function PreparationStatsStrip({
  labelsPrintedToday,
  ordersScannedToday,
  avgCycleSeconds,
  traySize,
  labels,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "16px 24px",
        backgroundColor: D.pageBg,
        borderBottom: `1px solid ${D.border}`,
        overflowX: "auto",
      }}
    >
      <StatTile
        icon={<Printer size={18} strokeWidth={1.5} />}
        label={labels.labelsPrinted}
        value={String(labelsPrintedToday)}
      />
      <StatTile
        icon={<ScanLine size={18} strokeWidth={1.5} />}
        label={labels.ordersScanned}
        value={String(ordersScannedToday)}
      />
      <StatTile
        icon={<Clock size={18} strokeWidth={1.5} />}
        label={labels.avgCycle}
        value={formatCycle(avgCycleSeconds)}
      />
      <StatTile
        icon={<PackageOpen size={18} strokeWidth={1.5} />}
        label={labels.traySize}
        value={String(traySize)}
      />
    </div>
  );
}
