"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "@/context/auth";

interface CarrierEvent {
  id: string;
  carrier_type: string | null;
  order_id: string | null;
  external_tracking_id: string | null;
  event_type: string | null;
  created_at: string;
  [key: string]: unknown;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface ApiResponse {
  data: CarrierEvent[];
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

export default function CarrierEventsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSWR<ApiResponse>(
    user?.role === "super_admin" ? `/api/admin/carrier-events?page=${page}` : null,
    fetcher
  );

  if (loading) return null;

  if (!user || user.role !== "super_admin") {
    if (typeof window !== "undefined") {
      router.replace(`/${params.locale}/dashboard`);
    }
    return null;
  }

  const events = data?.data ?? [];
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
        Carrier Events
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
                  <th style={thStyle}>Transporteur</th>
                  <th style={thStyle}>Commande</th>
                  <th style={thStyle}>Type d&apos;événement</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ ...tdStyle, textAlign: "center", color: "#6D7175", padding: 32 }}
                    >
                      Aucun événement trouvé.
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={tdStyle}>{formatDate(ev.created_at)}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            backgroundColor: "#E1E3E5",
                            color: "#1A1A1A",
                          }}
                        >
                          {ev.carrier_type ?? "—"}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                        {truncate(ev.order_id, 16)}
                      </td>
                      <td style={tdStyle}>{ev.event_type ?? "—"}</td>
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
