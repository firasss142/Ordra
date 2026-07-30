"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  market_manager: "Market Manager",
  agent: "Agent",
  warehouse_agent: "Agent entrepôt",
  investor: "Investisseur",
};

const MARKET_LABELS: Record<string, string> = {
  "00000000-0000-0000-0000-000000000001": "Tunisie",
  "00000000-0000-0000-0000-000000000002": "Libye",
};

interface FormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();

  const [form, setForm] = useState<FormState>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (!user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(null);
    setError(null);

    if (form.newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: form.currentPassword,
          new_password: form.newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Une erreur est survenue.");
      } else {
        setSuccess("Mot de passe modifié avec succès.");
        setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      }
    } catch {
      setError("Erreur réseau. Veuillez réessayer.");
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#6D7175",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 14,
    color: "#1A1A1A",
    padding: "8px 12px",
    backgroundColor: "#F6F6F7",
    border: "1px solid #E1E3E5",
    borderRadius: 4,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    fontSize: 14,
    color: "#1A1A1A",
    padding: "8px 12px",
    backgroundColor: "white",
    border: "1px solid #C9CCCF",
    borderRadius: 4,
    outline: "none",
    boxSizing: "border-box",
  };

  const marketLabel = user.market_id ? (MARKET_LABELS[user.market_id] ?? user.market_id) : "Tous les marchés";

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
        Mon profil
      </h1>

      {/* Profile info card */}
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          padding: 24,
          marginBottom: 24,
          maxWidth: 560,
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "#1A1A1A",
            margin: "0 0 20px 0",
            paddingBottom: 12,
            borderBottom: "1px solid #E1E3E5",
          }}
        >
          Informations du compte
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <span style={labelStyle}>Nom complet</span>
            <div style={valueStyle}>{user.full_name}</div>
          </div>
          <div>
            <span style={labelStyle}>Email</span>
            <div style={valueStyle}>{user.email}</div>
          </div>
          <div>
            <span style={labelStyle}>Rôle</span>
            <div style={valueStyle}>{ROLE_LABELS[user.role] ?? user.role}</div>
          </div>
          <div>
            <span style={labelStyle}>Marché</span>
            <div style={valueStyle}>{marketLabel}</div>
          </div>
        </div>
      </div>

      {/* Change password card */}
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          padding: 24,
          maxWidth: 560,
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "#1A1A1A",
            margin: "0 0 20px 0",
            paddingBottom: 12,
            borderBottom: "1px solid #E1E3E5",
          }}
        >
          Changer le mot de passe
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle} htmlFor="current_password">
              Mot de passe actuel
            </label>
            <input
              id="current_password"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
              style={inputStyle}
              disabled={submitting}
              required
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="new_password">
              Nouveau mot de passe
            </label>
            <input
              id="new_password"
              type="password"
              autoComplete="new-password"
              value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
              style={inputStyle}
              disabled={submitting}
              required
              minLength={8}
            />
            <span style={{ fontSize: 12, color: "#6D7175", marginTop: 4, display: "block" }}>
              Minimum 8 caractères
            </span>
          </div>

          <div>
            <label style={labelStyle} htmlFor="confirm_password">
              Confirmer le nouveau mot de passe
            </label>
            <input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              style={inputStyle}
              disabled={submitting}
              required
            />
          </div>

          {error && (
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "#FFF5F5",
                border: "1px solid #FED7D7",
                borderRadius: 4,
                fontSize: 13,
                color: "#C53030",
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "#F0FFF4",
                border: "1px solid #C6F6D5",
                borderRadius: 4,
                fontSize: 13,
                color: "#276749",
              }}
            >
              {success}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "8px 20px",
                fontSize: 14,
                fontWeight: 600,
                color: "white",
                backgroundColor: submitting ? "#6D7175" : "#1A1A1A",
                border: "none",
                borderRadius: 4,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
