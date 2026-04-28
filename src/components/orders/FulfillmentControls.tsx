"use client";

import { useState } from "react";
import { canUpdateFulfillment } from "@/lib/fulfillment-permissions";
import type { Role } from "@/types";
import type { OrderStatus } from "@/types/order-status";

interface FulfillmentControlsProps {
  orderId: string;
  status: OrderStatus;
  quantity: number;
  role: Role;
  onSuccess: () => void;
}

const btnStyle: React.CSSProperties = {
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "0.375rem",
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const btnSecondaryStyle: React.CSSProperties = {
  ...btnStyle,
  backgroundColor: "white",
  color: "#1A1A1A",
  border: "1px solid #D1D5DB",
};

async function postFulfillment(
  orderId: string,
  status: string,
  isDamaged?: boolean,
  note?: string
): Promise<void> {
  const res = await fetch(`/api/orders/${orderId}/fulfillment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, is_damaged: isDamaged, note }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? "Erreur");
  }
}

export function FulfillmentControls({
  orderId,
  status,
  quantity,
  role,
  onSuccess,
}: FulfillmentControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit confirmation state
  const [showDepositConfirm, setShowDepositConfirm] = useState(false);

  // Return inline expansion state
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [isDamaged, setIsDamaged] = useState(false);

  if (!canUpdateFulfillment(role)) return null;

  const TERMINAL = new Set(["delivered", "returned", "deleted", "cancelled", "rejected"]);
  if (TERMINAL.has(status)) {
    return (
      <div style={{ marginTop: 16 }}>
        <span style={{ fontSize: 13, color: "#6D7175" }}>Statut final</span>
      </div>
    );
  }

  async function doTransition(
    newStatus: string,
    opts?: { isDamaged?: boolean; note?: string }
  ) {
    setBusy(true);
    setError(null);
    try {
      await postFulfillment(orderId, newStatus, opts?.isDamaged, opts?.note);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      {error && (
        <p style={{ fontSize: 13, color: "#DC2626", marginBottom: 8 }}>{error}</p>
      )}

      {/* dispatched → deposit */}
      {status === "dispatched" && !showDepositConfirm && (
        <button
          style={btnStyle}
          disabled={busy}
          onClick={() => setShowDepositConfirm(true)}
        >
          Marquer comme reçu en dépôt
        </button>
      )}
      {status === "dispatched" && showDepositConfirm && (
        <div
          style={{
            border: "1px solid #E1E3E5",
            borderRadius: "0.375rem",
            padding: "12px 16px",
            fontSize: 13,
            color: "#1A1A1A",
          }}
        >
          <p style={{ margin: "0 0 12px 0" }}>
            Stock sera décrémenté de {quantity} unité(s). Confirmer ?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={btnStyle}
              disabled={busy}
              onClick={() => doTransition("deposit")}
            >
              Confirmer
            </button>
            <button
              style={btnSecondaryStyle}
              disabled={busy}
              onClick={() => setShowDepositConfirm(false)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* deposit → in_transit */}
      {status === "deposit" && (
        <button
          style={btnStyle}
          disabled={busy}
          onClick={() => doTransition("in_transit")}
        >
          Marquer en transit
        </button>
      )}

      {/* in_transit → delivered or to_be_returned */}
      {status === "in_transit" && !showReturnForm && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={btnStyle}
            disabled={busy}
            onClick={() => doTransition("delivered")}
          >
            Marquer comme livré
          </button>
          <button
            style={btnStyle}
            disabled={busy}
            onClick={() => setShowReturnForm(true)}
          >
            Marquer comme retourné
          </button>
        </div>
      )}

      {/* to_be_returned → returned */}
      {status === "to_be_returned" && !showReturnForm && (
        <button
          style={btnStyle}
          disabled={busy}
          onClick={() => setShowReturnForm(true)}
        >
          Confirmer le retour
        </button>
      )}

      {/* Return inline form */}
      {showReturnForm && (
        <div
          style={{
            border: "1px solid #E1E3E5",
            borderRadius: "0.375rem",
            padding: "12px 16px",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#1A1A1A",
              marginBottom: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={isDamaged}
              onChange={(e) => setIsDamaged(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Retour endommagé ?
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              style={btnStyle}
              disabled={busy}
              onClick={() => doTransition("returned", { isDamaged })}
            >
              Confirmer
            </button>
            <button
              style={btnSecondaryStyle}
              disabled={busy}
              onClick={() => {
                setShowReturnForm(false);
                setIsDamaged(false);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
