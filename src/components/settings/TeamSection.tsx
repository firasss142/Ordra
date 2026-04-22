"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import FocusTrap from "focus-trap-react";
import type { Role } from "@/types";
import { getPresence, PRESENCE_COLOR, PRESENCE_LABEL } from "@/lib/presence";
import { Avatar } from "@/components/ui/Avatar";
import { decodeAvatarFile, avatarErrorMessage } from "@/lib/client/image";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function lastSeenTooltip(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Jamais vu";
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Vu à l'instant";
  if (mins < 60) return `Vu il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Vu il y a ${hrs} h`;
  return `Vu il y a ${Math.floor(hrs / 24)} j`;
}

interface Agent {
  id: string;
  full_name: string;
  phone: string | null;
  email: string;
  avatar_url: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  market_id: string;
}

interface Market {
  id: string;
  name: string;
  code: string;
}

interface TeamSectionProps {
  role: Role;
  marketId: string;
  hideMarketSelector?: boolean;
}

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

const linkBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#2C6ECB",
  fontSize: 14,
  cursor: "pointer",
  padding: 0,
  marginRight: 12,
};

function httpError(status: number): string {
  if (status === 401) return "Session expirée — veuillez vous reconnecter";
  if (status === 403) return "Action non autorisée";
  if (status === 409) return "Conflit — rechargez la page";
  return "Erreur";
}

export function TeamSection({ role, marketId, hideMarketSelector }: TeamSectionProps) {
  const [selectedMarketId, setSelectedMarketId] = useState(marketId);

  useEffect(() => {
    if (hideMarketSelector && marketId && marketId !== selectedMarketId) {
      setSelectedMarketId(marketId);
    }
  }, [hideMarketSelector, marketId, selectedMarketId]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [deactivateMsg, setDeactivateMsg] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPwForm, setResetPwForm] = useState({ newPassword: "", confirmPassword: "" });
  const [resetPwError, setResetPwError] = useState("");
  const [resetPwSuccess, setResetPwSuccess] = useState<string | null>(null);

  const [form, setForm] = useState<{
    username: string;
    password: string;
    avatar: string | null;
  }>({
    username: "",
    password: "",
    avatar: null,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [updatingAvatarId, setUpdatingAvatarId] = useState<string | null>(null);
  const resetPwSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (resetPwSuccessTimer.current) clearTimeout(resetPwSuccessTimer.current);
    };
  }, []);

  const agentKey =
    selectedMarketId
      ? `/api/agents?market_id=${selectedMarketId}`
      : null;

  const { data: agentsData, mutate } = useSWR<{ data: Agent[] }>(agentKey, fetcher);
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher
  );

  const agents = agentsData?.data ?? [];
  const markets = marketsData?.data ?? [];

  useEffect(() => {
    if (!selectedMarketId && markets.length > 0) {
      setSelectedMarketId(markets[0].id);
    }
  }, [selectedMarketId, markets]);

  function openAdd() {
    setForm({ username: "", password: "", avatar: null });
    setPanelError("");
    setAvatarError("");
    setShowPassword(false);
    setPanelOpen(true);
  }

  async function decodeAndApply(
    file: File | undefined,
    apply: (dataUrl: string) => void
  ) {
    setAvatarError("");
    if (!file) return;
    const result = await decodeAvatarFile(file);
    if (!result.ok) {
      setAvatarError(avatarErrorMessage(result.error));
      return;
    }
    apply(result.dataUrl);
  }

  async function handleRowAvatarChange(agentId: string, file: File | undefined) {
    if (!file) return;
    const result = await decodeAvatarFile(file);
    if (!result.ok) return;
    setUpdatingAvatarId(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_avatar", avatar: result.dataUrl }),
      });
      if (res.ok) mutate();
    } finally {
      setUpdatingAvatarId(null);
    }
  }

  async function handleRowAvatarRemove(agentId: string) {
    setUpdatingAvatarId(agentId);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_avatar", avatar: null }),
      });
      if (res.ok) mutate();
    } finally {
      setUpdatingAvatarId(null);
    }
  }

  const closePanel = useCallback(() => setPanelOpen(false), []);

  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panelOpen, closePanel]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setPanelError("");

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          market_id: selectedMarketId,
          avatar: form.avatar,
        }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setPanelError((b as { error?: string }).error ?? httpError(res.status));
        return;
      }

      mutate();
      closePanel();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(agentId: string) {
    setDeactivateMsg(null);
    setDeactivateError(null);
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate" }),
    });
    if (res.ok) {
      setConfirmDeactivateId(null);
      setDeactivateMsg("Agent désactivé.");
      mutate();
    } else {
      const b = await res.json().catch(() => ({}));
      setDeactivateError((b as { error?: string }).error ?? httpError(res.status));
    }
  }

  async function handleReactivate(agentId: string) {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reactivate" }),
    });
    if (res.ok) {
      mutate();
    } else {
      const b = await res.json().catch(() => ({}));
      setDeactivateError((b as { error?: string }).error ?? httpError(res.status));
    }
  }

  async function handleResetPassword(e: React.FormEvent, agentId: string) {
    e.preventDefault();
    setResetPwError("");

    if (resetPwForm.newPassword.length < 8) {
      setResetPwError("Minimum 8 caractères requis.");
      return;
    }
    if (resetPwForm.newPassword !== resetPwForm.confirmPassword) {
      setResetPwError("Les mots de passe ne correspondent pas.");
      return;
    }

    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_password", new_password: resetPwForm.newPassword }),
    });

    if (res.ok) {
      setResetPasswordId(null);
      setResetPwForm({ newPassword: "", confirmPassword: "" });
      setResetPwSuccess("Mot de passe réinitialisé.");
      if (resetPwSuccessTimer.current) clearTimeout(resetPwSuccessTimer.current);
      resetPwSuccessTimer.current = setTimeout(() => setResetPwSuccess(null), 3000);
    } else {
      const b = await res.json().catch(() => ({}));
      setResetPwError((b as { error?: string }).error ?? httpError(res.status));
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
            Équipe
          </h2>
          {!hideMarketSelector && role === "super_admin" && markets.length > 0 && (
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              style={{
                height: 32,
                padding: "0 8px",
                fontSize: 13,
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                background: "white",
                cursor: "pointer",
              }}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
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

      {deactivateMsg && (
        <p style={{ fontSize: 13, color: "#008060", margin: "0 0 12px 0" }}>{deactivateMsg}</p>
      )}

      {resetPwSuccess && (
        <p style={{ fontSize: 13, color: "#008060", margin: "0 0 12px 0" }}>{resetPwSuccess}</p>
      )}

      {deactivateError && (
        <p style={{ fontSize: 13, color: "#D72C0D", margin: "0 0 12px 0" }}>{deactivateError}</p>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Nom</th>
              <th style={thStyle}>Téléphone</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Statut</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <React.Fragment key={agent.id}>
                <tr
                  style={{ background: "white" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = "#F7F7F7";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = "white";
                  }}
                >
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label
                        htmlFor={`avatar-input-${agent.id}`}
                        aria-label={`Changer la photo de ${agent.full_name}`}
                        title="Changer la photo"
                        style={{
                          cursor: "pointer",
                          opacity: updatingAvatarId === agent.id ? 0.5 : 1,
                        }}
                      >
                        <Avatar user={agent} size={32} />
                      </label>
                      <input
                        id={`avatar-input-${agent.id}`}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(e) =>
                          handleRowAvatarChange(agent.id, e.target.files?.[0])
                        }
                      />
                      <span>{agent.full_name}</span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "#6D7175" }}>{agent.phone ?? "—"}</td>
                  <td style={{ ...tdStyle, color: "#6D7175" }}>{agent.email}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Account active/inactive */}
                      <span
                        style={{ color: agent.is_active ? "#008060" : "#6D7175", fontSize: 16 }}
                        title={agent.is_active ? "Compte actif" : "Compte inactif"}
                      >
                        ●
                      </span>
                      {/* Presence dot */}
                      {(() => {
                        const presence = getPresence(agent.last_seen_at);
                        return (
                          <span
                            title={`${PRESENCE_LABEL[presence]} — ${lastSeenTooltip(agent.last_seen_at)}`}
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: PRESENCE_COLOR[presence],
                              flexShrink: 0,
                            }}
                          />
                        );
                      })()}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <button
                      onClick={() => {
                        if (resetPasswordId === agent.id) {
                          setResetPasswordId(null);
                        } else {
                          setResetPasswordId(agent.id);
                          setResetPwForm({ newPassword: "", confirmPassword: "" });
                          setResetPwError("");
                        }
                      }}
                      style={linkBtnStyle}
                    >
                      Réinitialiser le mot de passe
                    </button>
                    {agent.avatar_url && (
                      <button
                        onClick={() => handleRowAvatarRemove(agent.id)}
                        style={linkBtnStyle}
                        disabled={updatingAvatarId === agent.id}
                      >
                        Supprimer la photo
                      </button>
                    )}
                    {agent.is_active ? (
                      <button
                        onClick={() => {
                          setConfirmDeactivateId(agent.id);
                          setDeactivateMsg(null);
                        }}
                        style={linkBtnStyle}
                      >
                        Désactiver
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReactivate(agent.id)}
                        style={linkBtnStyle}
                      >
                        Réactiver
                      </button>
                    )}
                  </td>
                </tr>

                {/* Inline deactivation confirmation */}
                {confirmDeactivateId === agent.id && (
                  <tr key={`${agent.id}-confirm`}>
                    <td
                      colSpan={5}
                      style={{
                        padding: "12px 16px",
                        backgroundColor: "#F6F6F7",
                        borderBottom: "1px solid #E1E3E5",
                        fontSize: 14,
                      }}
                    >
                      <span style={{ color: "#1A1A1A", marginRight: 16 }}>
                        Désactiver {agent.full_name} ? Ses commandes ouvertes seront retournées au pool non affecté.
                      </span>
                      <button
                        onClick={() => handleDeactivate(agent.id)}
                        style={{
                          backgroundColor: "#1A1A1A",
                          color: "white",
                          border: "none",
                          borderRadius: "0.5rem",
                          padding: "6px 12px",
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: "pointer",
                          marginRight: 8,
                        }}
                      >
                        Confirmer la désactivation
                      </button>
                      <button
                        onClick={() => setConfirmDeactivateId(null)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#1A1A1A",
                          fontSize: 13,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Annuler
                      </button>
                    </td>
                  </tr>
                )}

                {/* Inline reset password form */}
                {resetPasswordId === agent.id && (
                  <tr key={`${agent.id}-reset`}>
                    <td
                      colSpan={5}
                      style={{
                        padding: "12px 16px",
                        backgroundColor: "#F6F6F7",
                        borderBottom: "1px solid #E1E3E5",
                      }}
                    >
                      <form
                        onSubmit={(e) => handleResetPassword(e, agent.id)}
                        style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}
                      >
                        <div>
                          <label htmlFor={`new-pw-${agent.id}`} style={labelStyle}>
                            Nouveau mot de passe
                          </label>
                          <input
                            id={`new-pw-${agent.id}`}
                            type="password"
                            value={resetPwForm.newPassword}
                            onChange={(e) =>
                              setResetPwForm((f) => ({ ...f, newPassword: e.target.value }))
                            }
                            style={inputStyle}
                          />
                        </div>
                        <div>
                          <label htmlFor={`confirm-pw-${agent.id}`} style={labelStyle}>
                            Confirmer le mot de passe
                          </label>
                          <input
                            id={`confirm-pw-${agent.id}`}
                            type="password"
                            value={resetPwForm.confirmPassword}
                            onChange={(e) =>
                              setResetPwForm((f) => ({ ...f, confirmPassword: e.target.value }))
                            }
                            style={inputStyle}
                          />
                        </div>
                        {resetPwError && (
                          <p style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>{resetPwError}</p>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="submit"
                            style={{
                              backgroundColor: "#1A1A1A",
                              color: "white",
                              border: "none",
                              borderRadius: "0.5rem",
                              padding: "6px 12px",
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: "pointer",
                            }}
                          >
                            Enregistrer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetPasswordId(null);
                              setResetPwError("");
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#1A1A1A",
                              fontSize: 13,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            Annuler
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {agents.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...tdStyle, color: "#6D7175", textAlign: "center", padding: 32 }}
                >
                  Aucun agent configuré
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Slide-in panel — Add agent */}
      {panelOpen && (
        <>
          <div
            onClick={closePanel}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(26,26,26,0.4)",
              zIndex: 40,
            }}
          />
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
                Ajouter un agent
              </h3>
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div>
                <label style={labelStyle}>Photo de profil</label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar
                    user={{ full_name: form.username, avatar_url: form.avatar }}
                    size={56}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label
                      htmlFor="agent-avatar"
                      style={{
                        display: "inline-block",
                        padding: "6px 12px",
                        border: "1px solid #E1E3E5",
                        borderRadius: "0.5rem",
                        fontSize: 13,
                        color: "#1A1A1A",
                        cursor: "pointer",
                        background: "white",
                      }}
                    >
                      {form.avatar ? "Changer" : "Choisir une image"}
                    </label>
                    <input
                      id="agent-avatar"
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) =>
                        decodeAndApply(e.target.files?.[0], (dataUrl) =>
                          setForm((f) => ({ ...f, avatar: dataUrl }))
                        )
                      }
                    />
                    {form.avatar && (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, avatar: null }))}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#D72C0D",
                          fontSize: 12,
                          cursor: "pointer",
                          padding: 0,
                          textAlign: "start",
                        }}
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
                {avatarError && (
                  <p style={{ fontSize: 12, color: "#D72C0D", margin: "6px 0 0 0" }}>
                    {avatarError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="agent-username" style={labelStyle}>
                  Nom d&apos;utilisateur
                </label>
                <input
                  id="agent-username"
                  type="text"
                  required
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="agent-password" style={labelStyle}>
                  Mot de passe
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="agent-password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    style={{ ...inputStyle, paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Masquer" : "Afficher"}
                    onClick={() => setShowPassword((v) => !v)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#6D7175",
                      fontSize: 14,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {panelError && (
                <p style={{ fontSize: 13, color: "#D72C0D", margin: 0 }}>{panelError}</p>
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
