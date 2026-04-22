"use client";

import { useState } from "react";
import type { MarketSnapshot } from "@/lib/dashboard/summary";

interface MarketsStripProps {
  markets: MarketSnapshot[];
  title: string;
  drillLabel: string;
  revenueLabel: string;
  profitLabel: string;
  ordersLabel: string;
  agentsLabel: string;
  confirmationLabel: string;
  rejectionLabel: string;
  onlineSuffix: string;
  onDrill: (marketId: string) => void;
}

export function MarketsStrip({
  markets,
  title,
  drillLabel,
  revenueLabel,
  profitLabel,
  ordersLabel,
  agentsLabel,
  confirmationLabel,
  rejectionLabel,
  onlineSuffix,
  onDrill,
}: MarketsStripProps) {
  if (markets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          color: "#1A1A1A",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.min(markets.length, 3)}, minmax(0, 1fr))`,
          gap: 16,
        }}
      >
        {markets.map((m) => (
          <MarketCard
            key={m.market_id}
            market={m}
            drillLabel={drillLabel}
            revenueLabel={revenueLabel}
            profitLabel={profitLabel}
            ordersLabel={ordersLabel}
            agentsLabel={agentsLabel}
            confirmationLabel={confirmationLabel}
            rejectionLabel={rejectionLabel}
            onlineSuffix={onlineSuffix}
            onDrill={() => onDrill(m.market_id)}
          />
        ))}
      </div>
    </div>
  );
}

function formatCurrency(value: number | null, currency: string): string {
  if (value == null) return "—";
  const formatted = Math.round(value).toLocaleString();
  return `${formatted} ${currency}`;
}

function MarketCard({
  market,
  drillLabel,
  revenueLabel,
  profitLabel,
  ordersLabel,
  agentsLabel,
  confirmationLabel,
  rejectionLabel,
  onlineSuffix,
  onDrill,
}: {
  market: MarketSnapshot;
  drillLabel: string;
  revenueLabel: string;
  profitLabel: string;
  ordersLabel: string;
  agentsLabel: string;
  confirmationLabel: string;
  rejectionLabel: string;
  onlineSuffix: string;
  onDrill: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
          {market.name}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {market.currency}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          fontSize: 13,
        }}
      >
        <Stat label={revenueLabel} value={formatCurrency(market.revenue, market.currency)} />
        <Stat label={profitLabel} value={formatCurrency(market.netProfit, market.currency)} />
        <Stat
          label={confirmationLabel}
          value={`${market.confirmationRate.toFixed(1)}%`}
          tone="success"
        />
        <Stat
          label={rejectionLabel}
          value={`${market.rejectionRate.toFixed(1)}%`}
          tone="critical"
        />
        <Stat label={ordersLabel} value={market.ordersProcessed.toLocaleString()} />
        <Stat
          label={agentsLabel}
          value={`${market.agentsOnline}/${market.agentsTotal} ${onlineSuffix}`}
        />
      </div>

      <button
        type="button"
        onClick={onDrill}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          alignSelf: "flex-end",
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 500,
          color: "#1A1A1A",
          background: hover ? "#F7F7F7" : "transparent",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          cursor: "pointer",
          transition: "background-color 120ms ease",
        }}
      >
        {drillLabel} →
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "critical";
}) {
  const color = tone === "success" ? "#008060" : tone === "critical" ? "#D72C0D" : "#1A1A1A";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 15,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
