"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Tag, ScanLine, PackageOpen, AlertTriangle } from "lucide-react";
import type { WarehouseKpis, WarehouseTrendPoint } from "@/lib/warehouse/summary";

const Sparkline = dynamic(
  () =>
    import("@/components/dashboard/charts/Sparkline").then((m) => m.Sparkline),
  { ssr: false, loading: () => <div style={{ height: "100%" }} /> },
);

const D = {
  cardBg:  "#02090A",
  border:  "#1E2C31",
  shadow:  "0 0 0 1px rgba(0,0,0,0.1), 0 2px 2px rgba(0,0,0,0.1), 0 4px 4px rgba(0,0,0,0.1), 0 8px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.03)",
  white:   "#FFFFFF",
  muted:   "#A1A1AA",
  success: "#36F4A4",
  danger:  "#F47272",
  info:    "#7FB8F5",
} as const;

interface WarehouseKpiStripProps {
  kpis: WarehouseKpis;
  trend: WarehouseTrendPoint[];
  locale: string;
  isMobile: boolean;
  labels: {
    pendingLabels: string;
    toScanOut: string;
    returnsInbox: string;
    damagedWeek: string;
    vsLastWeek: string;
    goToLabel: string;
    goToScan: string;
    goToReturns: string;
    goToHistory: string;
  };
}

interface KpiCardDef {
  label: string;
  value: number;
  icon: React.ReactNode;
  sparkline: React.ReactNode;
  delta: { text: string | null; tone: "success" | "critical" | "neutral" } | null;
  linkLabel: string;
  href: string;
}

function deltaTone(delta: number, invert?: boolean): "success" | "critical" | "neutral" {
  if (delta === 0) return "neutral";
  const positive = delta > 0;
  return (invert ? !positive : positive) ? "success" : "critical";
}

export function WarehouseKpiStrip({
  kpis,
  trend,
  locale,
  isMobile,
  labels,
}: WarehouseKpiStripProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const scanSeries = trend.map((p) => ({ value: p.scanned, day: p.day }));
  const damagedSeries = trend.map((p) => ({ value: p.damaged, day: p.day }));

  const damagedKpi = kpis.damagedThisWeek;
  const damagedDelta = (() => {
    if (damagedKpi.deltaPct == null || Number.isNaN(damagedKpi.deltaPct)) {
      return { text: null, tone: "neutral" as const };
    }
    const sign = damagedKpi.delta > 0 ? "+" : "";
    return {
      text: `${sign}${damagedKpi.deltaPct.toFixed(1)}% ${labels.vsLastWeek}`,
      tone: deltaTone(damagedKpi.delta, true),
    };
  })();

  const cards = useMemo<KpiCardDef[]>(() => [
    {
      label: labels.pendingLabels,
      value: kpis.pendingLabels.current,
      icon: <Tag size={18} strokeWidth={1.5} color={D.muted} />,
      sparkline: null,
      delta: null,
      linkLabel: labels.goToLabel,
      href: `/${locale}/warehouse/to-label`,
    },
    {
      label: labels.toScanOut,
      value: kpis.toScanOut.current,
      icon: <ScanLine size={18} strokeWidth={1.5} color={D.muted} />,
      sparkline: <Sparkline data={scanSeries} color={D.info} showTooltip />,
      delta: null,
      linkLabel: labels.goToScan,
      href: `/${locale}/warehouse/to-scan`,
    },
    {
      label: labels.returnsInbox,
      value: kpis.returnsInbox.current,
      icon: <PackageOpen size={18} strokeWidth={1.5} color={D.muted} />,
      sparkline: null,
      delta: null,
      linkLabel: labels.goToReturns,
      href: `/${locale}/warehouse/to-scan`,
    },
    {
      label: labels.damagedWeek,
      value: kpis.damagedThisWeek.current,
      icon: <AlertTriangle size={18} strokeWidth={1.5} color={D.muted} />,
      sparkline: <Sparkline data={damagedSeries} color={D.danger} showTooltip />,
      delta: damagedDelta,
      linkLabel: labels.goToHistory,
      href: `/${locale}/warehouse/history`,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [kpis, scanSeries, damagedSeries, damagedDelta, labels, locale]);

  return (
    <div
      style={
        isMobile
          ? {
              display: "flex",
              flexDirection: "row",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 4,
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
            }
          : {
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 16,
            }
      }
    >
      {cards.map((card, idx) => {
        const isHovered = hoveredIdx === idx;
        return (
          <div
            key={card.label}
            style={{
              background: D.cardBg,
              border: `1px solid ${isHovered ? "rgba(255,255,255,0.12)" : D.border}`,
              borderRadius: 12,
              boxShadow: D.shadow,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: isMobile ? 220 : undefined,
              flexShrink: isMobile ? 0 : undefined,
              scrollSnapAlign: isMobile ? "start" : undefined,
              transition: "border-color 150ms ease",
            }}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {card.icon}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: D.muted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {card.label}
              </span>
            </div>

            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: D.white,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {card.value.toLocaleString()}
            </div>

            {card.delta?.text && (
              <div style={{ display: "flex" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 9999,
                    padding: "3px 10px",
                    ...(card.delta.tone === "success"
                      ? { background: "rgba(54,244,164,0.12)", color: D.success }
                      : card.delta.tone === "critical"
                        ? { background: "rgba(244,114,114,0.12)", color: D.danger }
                        : { background: "rgba(255,255,255,0.06)", color: D.muted }),
                  }}
                >
                  {card.delta.text}
                </span>
              </div>
            )}

            {card.sparkline && (
              <div style={{ height: 44, marginTop: "auto" }}>{card.sparkline}</div>
            )}

            <Link
              href={card.href}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: isHovered ? D.white : D.muted,
                textDecoration: "none",
                transition: "color 120ms ease",
                marginTop: card.sparkline ? 0 : "auto",
              }}
            >
              {card.linkLabel} →
            </Link>
          </div>
        );
      })}
    </div>
  );
}
