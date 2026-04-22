"use client";

import { useRouter, useParams } from "next/navigation";
import useSWR from "swr";
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

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

interface MarketsSectionProps {
  role: Role;
}

export function MarketsSection({ role }: MarketsSectionProps) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();

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
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 16px 0",
        }}
      >
        Marchés
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Marché</th>
              <th style={thStyle}>Code</th>
              <th style={thStyle}>Statut</th>
              <th style={{ ...thStyle, textAlign: "end" }}>Commandes aujourd&apos;hui</th>
              <th style={{ ...thStyle, textAlign: "end" }}>Confirmées</th>
              <th style={{ ...thStyle, textAlign: "end" }}>Taux confirmation</th>
              <th style={{ ...thStyle, textAlign: "end" }}>Agents actifs</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market) => {
              const m = metricsMap[market.id];
              return (
                <tr key={market.id} style={{ background: "white" }}>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{market.name}</td>
                  <td
                    style={{
                      ...tdStyle,
                      fontFamily: "monospace",
                      color: "#6D7175",
                    }}
                  >
                    {market.code.toUpperCase()}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        color: market.is_active ? "#008060" : "#6D7175",
                        fontSize: 16,
                      }}
                    >
                      ●
                    </span>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "end",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {m?.orders_today ?? "—"}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "end",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {m?.confirmed_today ?? "—"}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "end",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {m?.confirmation_rate != null
                      ? `${m.confirmation_rate.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "end",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {m?.agents_active ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() =>
                        router.push(
                          `/${params.locale}/dashboard?market_id=${market.id}`,
                        )
                      }
                      style={{
                        background: "none",
                        border: "none",
                        color: "#2C6ECB",
                        fontSize: 13,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Voir tableau de bord
                    </button>
                  </td>
                </tr>
              );
            })}
            {markets.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    color: "#6D7175",
                    padding: 32,
                  }}
                >
                  Aucun marché configuré
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
