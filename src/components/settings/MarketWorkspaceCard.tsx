"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { HealthBadge, computeHealthState, formatRelative } from "./storefronts/HealthBadge";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Market {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface Storefront {
  id: string;
  market_id: string;
  platform: string;
  name: string;
  is_active: boolean;
  last_webhook_received_at: string | null;
  last_webhook_status: "processed" | "ignored" | "error" | null;
  webhook_failure_count: number;
}

interface MarketMetrics {
  market_id: string;
  orders_today: number;
  confirmed_today: number;
  confirmation_rate: number;
  agents_active: number;
}

interface MarketWorkspaceCardProps {
  market: Market;
  metrics?: MarketMetrics;
  role: Role;
  onOpenStorefronts: (marketId: string) => void;
}

export function MarketWorkspaceCard({
  market,
  metrics,
  role,
  onOpenStorefronts,
}: MarketWorkspaceCardProps) {
  const params = useParams<{ locale: string }>();
  const { data } = useSWR<{ data: Storefront[] }>(
    `/api/storefronts?market_id=${market.id}`,
    fetcher,
  );

  const storefronts = data?.data ?? [];

  const healthSummary = useMemo(() => {
    let ok = 0, failing = 0, stale = 0, never = 0;
    for (const s of storefronts) {
      if (!s.is_active) continue;
      const state = computeHealthState({
        is_active: s.is_active,
        last_webhook_received_at: s.last_webhook_received_at,
        last_webhook_status: s.last_webhook_status,
        webhook_failure_count: s.webhook_failure_count,
      });
      if (state === "ok") ok++;
      else if (state === "failing") failing++;
      else if (state === "stale") stale++;
      else if (state === "never") never++;
    }
    return { ok, failing, stale, never };
  }, [storefronts]);

  const hasAlerts = healthSummary.failing > 0 || healthSummary.stale > 0;

  return (
    <div
      style={{
        border: "1px solid #E1E3E5",
        borderRadius: "0.5rem",
        background: "white",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: 20,
          borderBottom: "1px solid #E1E3E5",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 600,
                color: "#1A1A1A",
              }}
            >
              {market.name}
            </h3>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 4,
                background: "#F6F6F7",
                color: "#6D7175",
              }}
            >
              {market.code.toUpperCase()}
            </span>
            <span
              style={{
                color: market.is_active ? "#008060" : "#6D7175",
                fontSize: 14,
              }}
              aria-label={market.is_active ? "Actif" : "Inactif"}
            >
              ●
            </span>
          </div>
          <div style={{ fontSize: 13, color: "#6D7175", marginTop: 4 }}>
            {storefronts.length} storefront{storefronts.length !== 1 ? "s" : ""}
            {" · "}
            {metrics
              ? `${metrics.orders_today} commandes aujourd'hui`
              : "— commandes"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {hasAlerts && (
            <Link
              href={`/${params.locale}/dashboard/alerts`}
              style={{
                fontSize: 13,
                color: "#D72C0D",
                textDecoration: "none",
                padding: "6px 12px",
                border: "1px solid #FDEDEA",
                background: "#FDEDEA",
                borderRadius: "0.375rem",
              }}
            >
              {healthSummary.failing + healthSummary.stale} alerte
              {healthSummary.failing + healthSummary.stale !== 1 ? "s" : ""}
            </Link>
          )}
          <Link
            href={`/${params.locale}/dashboard?market_id=${market.id}`}
            style={{
              fontSize: 13,
              color: "#1A1A1A",
              textDecoration: "none",
              padding: "6px 12px",
              border: "1px solid #E1E3E5",
              borderRadius: "0.375rem",
            }}
          >
            Tableau de bord
          </Link>
        </div>
      </div>

      {/* Metrics strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: "1px solid #E1E3E5",
          background: "#FAFAFB",
        }}
      >
        <Metric label="Commandes" value={metrics?.orders_today ?? "—"} />
        <Metric label="Confirmées" value={metrics?.confirmed_today ?? "—"} />
        <Metric
          label="Taux conf."
          value={
            metrics?.confirmation_rate != null
              ? `${metrics.confirmation_rate.toFixed(1)}%`
              : "—"
          }
        />
        <Metric label="Agents actifs" value={metrics?.agents_active ?? "—"} last />
      </div>

      {/* Storefronts list */}
      <div style={{ padding: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h4
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "#1A1A1A",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Storefronts
          </h4>
          {role === "super_admin" && (
            <button
              onClick={() => onOpenStorefronts(market.id)}
              style={{
                background: "#1A1A1A",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              + Connecter
            </button>
          )}
        </div>

        {storefronts.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: "#6D7175",
              padding: "24px 0",
              textAlign: "center",
            }}
          >
            Aucun storefront connecté pour ce marché.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {storefronts.map((s) => {
              const state = computeHealthState({
                is_active: s.is_active,
                last_webhook_received_at: s.last_webhook_received_at,
                last_webhook_status: s.last_webhook_status,
                webhook_failure_count: s.webhook_failure_count,
              });
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    border: "1px solid #E1E3E5",
                    borderRadius: "0.375rem",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                      {s.platform} · dernier webhook{" "}
                      {formatRelative(s.last_webhook_received_at)}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <HealthBadge state={state} />
                    {role === "super_admin" && (
                      <button
                        onClick={() => onOpenStorefronts(market.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#2C6ECB",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        Gérer
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string | number;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRight: last ? "none" : "1px solid #E1E3E5",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: "#1A1A1A",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
