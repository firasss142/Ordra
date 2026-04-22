"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface LogRow {
  id: string;
  product_id: string;
  order_id: string | null;
  change: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

interface StockHistoryPanelProps {
  productId: string;
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "start",
  fontSize: 12,
  fontWeight: 600,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

export function StockHistoryPanel({ productId }: StockHistoryPanelProps) {
  const [page, setPage] = useState(1);
  const t = useTranslations("products");

  const { data, isLoading } = useSWR<{
    data: LogRow[];
    pagination: { page: number; limit: number; total: number };
  }>(`/api/products/${productId}/stock?page=${page}&limit=20`, fetcher);

  const rows = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A", marginBottom: 12 }}>
        Historique du stock
      </div>

      {isLoading && (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Chargement…
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#6D7175" }}>
          Aucun mouvement de stock
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid #E1E3E5", borderRadius: "0.375rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={{ ...thStyle, textAlign: "end" }}>Mouvement</th>
                  <th style={thStyle}>Motif</th>
                  <th style={thStyle}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ ...tdStyle, color: "#6D7175" }}>
                      {new Date(row.created_at).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "end",
                        fontWeight: 600,
                        fontVariantNumeric: "tabular-nums",
                        color: row.change > 0 ? "#008060" : "#D72C0D",
                      }}
                    >
                      {row.change > 0 ? `+${row.change}` : row.change}
                    </td>
                    <td style={tdStyle}>
                      {t(`stockReasons.${row.reason}` as Parameters<typeof t>[0]) ?? row.reason}
                    </td>
                    <td style={{ ...tdStyle, color: "#6D7175" }}>{row.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, justifyContent: "flex-end" }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{ padding: "4px 12px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, background: "white", cursor: page <= 1 ? "not-allowed" : "pointer", color: page <= 1 ? "#9CA3AF" : "#1A1A1A" }}
              >
                Précédent
              </button>
              <span style={{ fontSize: 13, color: "#6D7175" }}>
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{ padding: "4px 12px", fontSize: 13, border: "1px solid #E1E3E5", borderRadius: 4, background: "white", cursor: page >= totalPages ? "not-allowed" : "pointer", color: page >= totalPages ? "#9CA3AF" : "#1A1A1A" }}
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
