"use client";

import { useState } from "react";
import useSWR from "swr";
import { MarketWorkspaceCard } from "./MarketWorkspaceCard";
import { StorefrontsSection } from "./StorefrontsSection";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Market {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface MarketMetrics {
  market_id: string;
  orders_today: number;
  confirmed_today: number;
  confirmation_rate: number;
  agents_active: number;
}

interface MarketsSectionProps {
  role: Role;
}

export function MarketsSection({ role }: MarketsSectionProps) {
  const [drawerMarketId, setDrawerMarketId] = useState<string | null>(null);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher,
  );

  const today = new Date().toISOString().slice(0, 10);
  const { data: metricsData } = useSWR<{ data: MarketMetrics[] }>(
    role === "super_admin"
      ? `/api/metrics/cross-market?from_date=${today}&to_date=${today}`
      : null,
    fetcher,
  );

  if (role !== "super_admin") return null;

  const markets = marketsData?.data ?? [];
  const metrics = metricsData?.data ?? [];
  const metricsMap = Object.fromEntries(metrics.map((m) => [m.market_id, m]));

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#1A1A1A",
              margin: 0,
            }}
          >
            Marchés
          </h2>
          <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0 0" }}>
            Chaque marché est un espace de travail isolé avec ses storefronts, transporteurs et agents.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(520px, 100%), 1fr))",
          gap: 20,
        }}
      >
        {markets.map((market) => (
          <MarketWorkspaceCard
            key={market.id}
            market={market}
            metrics={metricsMap[market.id]}
            role={role}
            onOpenStorefronts={setDrawerMarketId}
          />
        ))}
        {markets.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: 40,
              textAlign: "center",
              color: "#6D7175",
              border: "1px dashed #E1E3E5",
              borderRadius: "0.5rem",
              fontSize: 13,
            }}
          >
            Aucun marché configuré
          </div>
        )}
      </div>

      {/* Storefront management drawer (super_admin only) */}
      {drawerMarketId && (
        <div
          role="dialog"
          aria-label="Gestion des storefronts"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(720px, 100vw)",
            background: "white",
            borderLeft: "1px solid #E1E3E5",
            zIndex: 45,
            overflowY: "auto",
            padding: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              Storefronts — {markets.find((m) => m.id === drawerMarketId)?.name}
            </h3>
            <button
              onClick={() => setDrawerMarketId(null)}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#6D7175",
              }}
              aria-label="Fermer"
            >
              ✕
            </button>
          </div>
          <StorefrontsSection role={role} marketId={drawerMarketId} />
        </div>
      )}
      {drawerMarketId && (
        <div
          onClick={() => setDrawerMarketId(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(26,26,26,0.3)",
            zIndex: 44,
          }}
        />
      )}
    </div>
  );
}
