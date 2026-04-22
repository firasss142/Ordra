"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "@/context/auth";

interface WebhookLog {
  id: string;
  storefront_id: string | null;
  external_id: string | null;
  event_type: string | null;
  status: string | null;
  error_message: string | null;
  created_at: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface ApiResponse {
  data: WebhookLog[];
  pagination: Pagination;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(s: string | null, n = 20): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function StatusBadge({ status }: { status: string | null }) {
  let bg = "#E1E3E5";
  let color = "#1A1A1A";
  if (status === "delivered") { bg = "#D4EDDA"; color = "#155724"; }
  else if (status === "failed") { bg = "#F8D7DA"; color = "#721C24"; }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: bg,
        color,
      }}
    >
      {status ?? "—"}
    </span>
  );
}

export default function WebhookLogsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSWR<ApiResponse>(
    user?.role === "super_admin" ? `/api/admin/webhook-logs?page=${page}` : null,
    fetcher
  );

  if (loading) return null;

  if (!user || user.role !== "super_admin") {
    if (typeof window !== "undefined") {
      router.replace(`/${params.locale}/dashboard`);
    }
    return null;
  }

  const logs = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / pagination.limit) : 1;

  const thStyle: React.CSSProperties = {
    padding: "10px 12px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 600,
    color: "#6D7175",
    borderBottom: "1px solid #E1E3E5",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: 13,
    color: "#1A1A1A",
    borderBottom: "1px solid #F1F2F3",
    verticalAlign: "middle",
  };

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        Webhook Logs
      </h1>

      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          overflow: "hidden",
        }}
      >
        {isLoading ? (
          <div style={{ padding: 32, textAlign: "center", color: "#6D7175", fontSize: 14 }}>
            Chargement…
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ backgroundColor: "#F6F6F7" }}>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Storefront</th>
                  <th style={thStyle}>External ID</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Statut</th>
                  <th style={thStyle}>Erreur</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ ...tdStyle, textAlign: "center", color: "#6D7175", padding: 32 }}
                    >
                      Aucun log trouvé.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} style={{ transition: "background 0.1s" }}>
                      <td style={tdStyle}>{formatDate(log.created_at)}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                        {truncate(log.storefront_id, 16)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                        {truncate(log.external_id, 20)}
                      </td>
                      <td style={tdStyle}>{log.event_type ?? "—"}</td>
                      <td style={tdStyle}>
                        <StatusBadge status={log.status} />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          maxWidth: 260,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: log.error_message ? "#721C24" : "#6D7175",
                          fontSize: 12,
                        }}
                        title={log.error_message ?? undefined}
                      >
                        {log.error_message ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.total > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid #E1E3E5",
              backgroundColor: "#FAFAFA",
            }}
          >
            <span style={{ fontSize: 13, color: "#6D7175" }}>
              {pagination.total} entrée{pagination.total !== 1 ? "s" : ""} — page {page} / {totalPages}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  border: "1px solid #E1E3E5",
                  borderRadius: 4,
                  backgroundColor: page <= 1 ? "#F6F6F7" : "white",
                  color: page <= 1 ? "#9CA3AF" : "#1A1A1A",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Précédent
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 500,
                  border: "1px solid #E1E3E5",
                  borderRadius: 4,
                  backgroundColor: page >= totalPages ? "#F6F6F7" : "white",
                  color: page >= totalPages ? "#9CA3AF" : "#1A1A1A",
                  cursor: page >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
