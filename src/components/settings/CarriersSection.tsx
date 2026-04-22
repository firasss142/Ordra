"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import { canManageCarriers } from "@/lib/settings-permissions";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Carrier {
  id: string;
  market_id: string;
  name: string;
  api_endpoint: string;
  api_credentials: string;
  delivery_fee: number;
  return_fee: number;
  is_active: boolean;
}

interface CarriersSectionProps {
  role: Role;
  marketId: string;
  currency?: string;
}

const MASK = "••••••••";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #E1E3E5",
  borderRadius: "0.5rem",
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};

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

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function CarriersSection({ role, marketId, currency = "TND" }: CarriersSectionProps) {
  const { data, mutate } = useSWR<{ data: Carrier[] }>(
    marketId ? `/api/carriers?market_id=${marketId}` : null,
    fetcher
  );

  const carriers = data?.data ?? [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [editCarrier, setEditCarrier] = useState<Carrier | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  if (!canManageCarriers(role)) return null;

  function httpError(status: number): string {
    if (status === 401) return "Session expirée — veuillez vous reconnecter";
    if (status === 403) return "Action non autorisée";
    if (status === 409) return "Conflit — rechargez la page";
    return "Erreur";
  }

  // Form state
  const [form, setForm] = useState({
    name: "",
    api_endpoint: "",
    api_key: "",
    delivery_fee: "",
    return_fee: "",
  });

  function openAdd() {
    setEditCarrier(null);
    setForm({ name: "", api_endpoint: "", api_key: "", delivery_fee: "", return_fee: "" });
    setErrorMsg("");
    setPanelOpen(true);
  }

  function openEdit(c: Carrier) {
    setEditCarrier(c);
    setForm({
      name: c.name,
      api_endpoint: c.api_endpoint,
      api_key: MASK,
      delivery_fee: String(c.delivery_fee),
      return_fee: String(c.return_fee),
    });
    setErrorMsg("");
    setPanelOpen(true);
  }

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setEditCarrier(null);
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panelOpen, closePanel]);

  async function handleToggleActive(c: Carrier) {
    // Optimistic update
    await mutate(
      (prev) => ({
        data: (prev?.data ?? []).map((x) =>
          x.id === c.id ? { ...x, is_active: !c.is_active } : x
        ),
      }),
      false
    );
    await fetch(`/api/carriers/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !c.is_active }),
    });
    mutate();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");

    try {
      if (editCarrier) {
        // PATCH
        const body: Record<string, unknown> = {
          name: form.name,
          api_endpoint: form.api_endpoint,
          delivery_fee: parseFloat(form.delivery_fee) || 0,
          return_fee: parseFloat(form.return_fee) || 0,
        };
        // Only send api_key if user changed it from the mask
        if (form.api_key !== MASK) {
          body.api_key = form.api_key;
        }
        const res = await fetch(`/api/carriers/${editCarrier.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
      } else {
        // POST
        const res = await fetch("/api/carriers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market_id: marketId,
            name: form.name,
            code: form.name.toLowerCase().replace(/\s+/g, "_"),
            api_endpoint: form.api_endpoint,
            api_key: form.api_key,
            delivery_fee: parseFloat(form.delivery_fee) || 0,
            return_fee: parseFloat(form.return_fee) || 0,
          }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setErrorMsg((b as { error?: string }).error ?? httpError(res.status));
          return;
        }
      }

      mutate();
      closePanel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          Transporteurs
        </h2>
        <button
          onClick={openAdd}
          style={{
            backgroundColor: "#1A1A1A",
            color: "white",
            border: "none",
            borderRadius: "0.5rem",
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Ajouter
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Nom</th>
              <th style={thStyle}>Endpoint</th>
              <th style={thStyle}>Frais livraison</th>
              <th style={thStyle}>Frais retour</th>
              <th style={thStyle}>Actif</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c) => (
              <tr
                key={c.id}
                style={{ background: "white" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "#F7F7F7";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "white";
                }}
              >
                <td style={tdStyle}>{c.name}</td>
                <td style={{ ...tdStyle, color: "#6D7175", fontFamily: "monospace", fontSize: 13 }}>
                  {truncate(c.api_endpoint, 40)}
                </td>
                <td style={tdStyle}>{c.delivery_fee} {currency}</td>
                <td style={tdStyle}>{c.return_fee} {currency}</td>
                <td style={tdStyle}>
                  <span style={{ color: c.is_active ? "#008060" : "#6D7175", fontSize: 16 }}>●</span>
                </td>
                <td style={tdStyle}>
                  <button
                    onClick={() => openEdit(c)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#2C6ECB",
                      fontSize: 14,
                      cursor: "pointer",
                      padding: 0,
                      marginRight: 12,
                    }}
                  >
                    Modifier
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", gap: 6 }}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={c.is_active}
                      onChange={() => handleToggleActive(c)}
                      style={{ width: 32, height: 18, cursor: "pointer", accentColor: "#1A1A1A" }}
                    />
                  </label>
                </td>
              </tr>
            ))}
            {carriers.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, color: "#6D7175", textAlign: "center", padding: 32 }}>
                  Aucun transporteur configuré
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-in panel */}
      {panelOpen && (
        <>
          {/* Overlay */}
          <div
            onClick={closePanel}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.4)",
              zIndex: 40,
            }}
          />
          {/* Panel */}
          <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => panelRef.current ?? document.body }}>
          <div
            ref={panelRef}
            tabIndex={-1}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: 420,
              backgroundColor: "white",
              borderLeft: "1px solid #E1E3E5",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #E1E3E5" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
                {editCarrier ? "Modifier le transporteur" : "Ajouter un transporteur"}
              </h3>
            </div>

            <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Nom</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Endpoint API</label>
                <input
                  type="url"
                  required
                  value={form.api_endpoint}
                  onChange={(e) => setForm((f) => ({ ...f, api_endpoint: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Clé API</label>
                <input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                  style={inputStyle}
                  placeholder={editCarrier ? "Laisser tel quel pour ne pas modifier" : ""}
                />
              </div>

              <div>
                <label style={labelStyle}>Frais de livraison ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.delivery_fee}
                  onChange={(e) => setForm((f) => ({ ...f, delivery_fee: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Frais de retour ({currency})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.return_fee}
                  onChange={(e) => setForm((f) => ({ ...f, return_fee: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              {errorMsg && (
                <p style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>{errorMsg}</p>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    backgroundColor: "#1A1A1A",
                    color: "white",
                    border: "none",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  onClick={closePanel}
                  style={{
                    backgroundColor: "white",
                    color: "#1A1A1A",
                    border: "1px solid #E1E3E5",
                    borderRadius: "0.5rem",
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
          </FocusTrap>
        </>
      )}
    </>
  );
}
