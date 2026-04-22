"use client";

import { useEffect, useState } from "react";

interface Agent {
  id: string;
  full_name: string;
}

interface ReassignControlsProps {
  selectedOrderIds: string[];
  currentAgentId: string;
  marketId: string | null;
  onDone: () => void;
}

export function ReassignControls({
  selectedOrderIds,
  currentAgentId,
  onDone,
}: ReassignControlsProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((json) => {
        const all: Agent[] = (json.data ?? []) as Agent[];
        setAgents(all.filter((a) => a.id !== currentAgentId));
      })
      .catch(() => {
        /* non-critical — dropdown stays empty */
      });
  }, [currentAgentId]);

  function httpErrorMsg(status: number): string {
    if (status === 401) return "Session expirée — veuillez vous reconnecter";
    if (status === 403) return "Action non autorisée";
    if (status === 409) return "Statut déjà modifié — rechargez la page";
    return "Erreur";
  }

  async function postReassign(orderId: string, agentId: string | null) {
    const res = await fetch(`/api/orders/${orderId}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_agent_id: agentId }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error ?? httpErrorMsg(res.status));
    }
  }

  async function handleReturnToPool() {
    setBusy(true);
    setError(null);
    try {
      await Promise.all(selectedOrderIds.map((id) => postReassign(id, null)));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function handleReassign() {
    if (!targetAgentId) return;
    setBusy(true);
    setError(null);
    try {
      await Promise.all(selectedOrderIds.map((id) => postReassign(id, targetAgentId)));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "12px 24px",
        borderTop: "1px solid #E1E3E5",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {error && (
        <p style={{ fontSize: 13, color: "#DC2626", margin: 0 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          disabled={busy}
          onClick={handleReturnToPool}
          style={{
            backgroundColor: busy ? "#9CA3AF" : "#1A1A1A",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: busy ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Retourner au pool
        </button>

        <select
          value={targetAgentId}
          onChange={(e) => setTargetAgentId(e.target.value)}
          disabled={busy}
          style={{
            flex: 1,
            height: 36,
            padding: "0 8px",
            fontSize: 13,
            border: "1px solid #E1E3E5",
            borderRadius: "0.375rem",
            background: "white",
            cursor: "pointer",
          }}
        >
          <option value="">Réassigner à…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>

        {targetAgentId && (
          <button
            disabled={busy}
            onClick={handleReassign}
            style={{
              backgroundColor: busy ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Confirmer
          </button>
        )}
      </div>
    </div>
  );
}
