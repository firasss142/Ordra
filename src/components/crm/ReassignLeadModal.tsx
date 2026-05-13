"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Lead } from "@/types/lead";

interface Agent {
  id: string;
  full_name: string;
  email: string;
}

interface Props {
  open: boolean;
  lead: Pick<Lead, "id" | "customer_name" | "assigned_to">;
  marketId: string;
  onClose: () => void;
  onDone: () => void;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ReassignLeadModal({ open, lead, marketId, onClose, onDone }: Props) {
  const t = useTranslations("crm.leads.reassignModal");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useSWR<{ data: Agent[] }>(
    open ? `/api/agents?market_id=${marketId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const agents = data?.data ?? [];

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAgentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? t("errors.generic"));
        return;
      }
      onDone();
      onClose();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          width: 400,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: "0 0 16px" }}>
          {t("title")}
        </h2>

        <p style={{ fontSize: 13, color: "#6D7175", margin: "0 0 16px" }}>
          {lead.customer_name}
        </p>

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: "#6D7175",
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {t("agent")}
          </label>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{
              width: "100%",
              height: 36,
              padding: "0 8px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              fontSize: 14,
              color: "#1A1A1A",
              background: "#fff",
              marginBottom: 16,
            }}
          >
            <option value="">{t("selectAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>

          {error && (
            <p style={{ fontSize: 13, color: "#D72C0D", margin: "0 0 12px" }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                border: "1px solid #D1D5DB",
                borderRadius: 4,
                background: "#fff",
                fontSize: 14,
                cursor: "pointer",
                color: "#1A1A1A",
              }}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedAgentId}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 4,
                background: selectedAgentId ? "#1A1A1A" : "#D1D5DB",
                color: "#fff",
                fontSize: 14,
                cursor: submitting || !selectedAgentId ? "default" : "pointer",
                fontWeight: 500,
              }}
            >
              {t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
