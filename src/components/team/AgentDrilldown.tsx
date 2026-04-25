"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { ReassignControls } from "./ReassignControls";
import { AgentHistoryPanel } from "./AgentHistoryPanel";
import { ManagerNotesEditor } from "./ManagerNotesEditor";
import type { Role } from "@/types";

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${r.status}`);
  }
  return r.json();
};

interface AgentQueueOrder {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  product_name: string;
  variant_label: string | null;
  total_price: number;
  currency: string;
  quantity: number;
  callback_scheduled_at: string | null;
  created_at: string;
}

interface RejectionRow {
  reason: string;
  count: number;
  percentage: number;
}

interface AgentDrilldownProps {
  agentId: string;
  agentName: string;
  marketId?: string;
  percentileRank?: number;
  role?: Role;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  assigned: "Assigné",
  attempt_1: "Tentative 1",
  attempt_2: "Tentative 2",
  attempt_3: "Tentative 3",
  callback_scheduled: "Rappel prévu",
  confirmed: "Confirmé",
};

function statusDotColor(status: string): string {
  if (status === "assigned") return "#9CA3AF";
  if (status === "attempt_1" || status === "attempt_2" || status === "attempt_3") return "#D97706";
  if (status === "callback_scheduled") return "#2563EB";
  if (status === "confirmed") return "#16A34A";
  return "#9CA3AF";
}

const REJECTION_LABELS: Record<string, string> = {
  refus_client: "Refus client",
  faux_numero: "Faux numéro",
  doublon: "Doublon",
  injoignable: "Injoignable",
  prix: "Prix",
  non_serieux: "Non sérieux",
  autre: "Autre",
};

type Tab = "queue" | "history" | "notes";

export function AgentDrilldown({
  agentId,
  agentName,
  marketId,
  percentileRank,
  role,
  onClose,
}: AgentDrilldownProps) {
  const t = useTranslations("teamPerf.drilldown");
  const [orders, setOrders] = useState<AgentQueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("queue");

  const today = new Date().toISOString().slice(0, 10);
  const marketParam = marketId ? `&market_id=${marketId}` : "";
  const metricsUrl = `/api/team/metrics?from_date=${today}&to_date=${today}&agent_id=${agentId}${marketParam}`;
  const { data: metricsData } = useSWR<{ data: { rejection_breakdown: RejectionRow[] } }>(
    tab === "queue" ? metricsUrl : null,
    fetcher
  );

  useEffect(() => {
    if (tab !== "queue") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(`/api/team/${agentId}/queue`);
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        const json = await r.json();
        if (cancelled) return;
        setOrders((json.data ?? []) as AgentQueueOrder[]);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erreur de chargement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, tab]);

  function toggleSelect(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === orders.length && orders.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map((o) => o.id)));
    }
  }

  const tabBtn = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 8px",
    fontSize: 13,
    fontWeight: isActive ? 600 : 500,
    color: isActive ? "#1A1A1A" : "#6D7175",
    background: "none",
    border: "none",
    borderBottom: isActive ? "2px solid #1A1A1A" : "2px solid transparent",
    cursor: "pointer",
  });

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(26, 26, 26, 0.4)",
          zIndex: 40,
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          insetInlineEnd: 0,
          bottom: 0,
          width: 520,
          backgroundColor: "#FFFFFF",
          borderInlineStart: "1px solid #E1E3E5",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px 10px",
            borderBottom: "1px solid #E1E3E5",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {agentName}
            </span>
            <button
              style={{
                background: "none",
                border: "none",
                fontSize: 14,
                color: "#6B7280",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={onClose}
            >
              Fermer
            </button>
          </div>
          {typeof percentileRank === "number" && (
            <div style={{ marginTop: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#374151",
                  background: "#F3F4F6",
                  padding: "2px 8px",
                  borderRadius: 10,
                }}
              >
                {t("percentile", { rank: Math.round(percentileRank) })}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #E1E3E5", flexShrink: 0 }}>
          <button type="button" style={tabBtn(tab === "queue")} onClick={() => setTab("queue")}>
            {t("tabQueue")}
          </button>
          <button type="button" style={tabBtn(tab === "history")} onClick={() => setTab("history")}>
            {t("tabHistory")}
          </button>
          {marketId && (
            <button type="button" style={tabBtn(tab === "notes")} onClick={() => setTab("notes")}>
              {t("tabNotes")}
            </button>
          )}
        </div>

        {/* Body */}
        {tab === "queue" && (
          <>
            {orders.length > 0 && (
              <div
                style={{
                  padding: "8px 24px",
                  borderBottom: "1px solid #E1E3E5",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.size === orders.length && orders.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: "pointer" }}
                />
                <span style={{ fontSize: 13, color: "#6D7175" }}>
                  {selected.size > 0
                    ? `${selected.size} sélectionnée(s)`
                    : "Tout sélectionner"}
                </span>
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                paddingBottom: selected.size > 0 ? 72 : 0,
              }}
            >
              {loading && (
                <div
                  style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6B7280" }}
                >
                  Chargement…
                </div>
              )}
              {error && (
                <div
                  style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#DC2626" }}
                >
                  {error}
                </div>
              )}
              {!loading && !error && orders.length === 0 && (
                <div
                  style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6B7280" }}
                >
                  File d&apos;attente vide
                </div>
              )}

              {orders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "16px 24px",
                    borderBottom: "1px solid #E1E3E5",
                    backgroundColor: selected.has(order.id) ? "#F6F6F7" : "#FFFFFF",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    style={{ marginTop: 3, cursor: "pointer", flexShrink: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}
                        >
                          {order.customer_name}
                        </span>
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 13,
                            color: "#6B7280",
                          }}
                        >
                          <span style={{ color: statusDotColor(order.status), fontSize: 10 }}>
                            ●
                          </span>
                          {STATUS_LABELS[order.status] ?? order.status}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: "#9CA3AF" }}>
                        {new Date(order.created_at).toLocaleDateString("fr-TN", {
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "#6B7280" }}>
                        {order.customer_city ?? "—"}
                      </span>
                      <div style={{ textAlign: "end" }}>
                        <div style={{ fontSize: 13, color: "#374151" }}>
                          {order.product_name}
                          {order.variant_label ? ` · ${order.variant_label}` : ""}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
                          {order.total_price} {order.currency}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {metricsData?.data?.rejection_breakdown &&
              metricsData.data.rejection_breakdown.length > 0 && (
                <div
                  style={{
                    padding: "16px 24px",
                    borderTop: "1px solid #E1E3E5",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6B7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 10,
                    }}
                  >
                    Motifs de rejet (aujourd&apos;hui)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {metricsData.data.rejection_breakdown.map((row) => (
                      <div
                        key={row.reason}
                        style={{ display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <div
                          style={{
                            width: 110,
                            fontSize: 12,
                            color: "#374151",
                            flexShrink: 0,
                          }}
                        >
                          {REJECTION_LABELS[row.reason] ?? row.reason}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            backgroundColor: "#E1E3E5",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${row.percentage}%`,
                              backgroundColor: "#D72C0D",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#6B7280",
                            minWidth: 40,
                            textAlign: "end",
                          }}
                        >
                          {row.count} ({row.percentage.toFixed(0)}%)
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {selected.size > 0 && (
              <ReassignControls
                selectedOrderIds={Array.from(selected)}
                currentAgentId={agentId}
                marketId={null}
                onDone={onClose}
              />
            )}
          </>
        )}

        {tab === "history" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <AgentHistoryPanel agentId={agentId} />
          </div>
        )}

        {tab === "notes" && marketId && role && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ManagerNotesEditor agentId={agentId} marketId={marketId} role={role} />
          </div>
        )}
      </div>
    </>
  );
}
