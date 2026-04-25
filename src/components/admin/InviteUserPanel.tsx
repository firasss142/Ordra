"use client";

import React, { useEffect, useRef, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import { X, Copy, Check } from "lucide-react";
import type { Role } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  open: boolean;
  actorRole: Role;
  actorMarketId: string | null;
  markets: Market[];
  onClose: () => void;
  onInvite: (payload: { username: string; role: string; market_id?: string }) => Promise<{ inviteLink: string }>;
}

const SUPER_ADMIN_CREATABLE: Role[] = ["market_manager", "agent", "warehouse_agent"];
const MANAGER_CREATABLE: Role[] = ["agent", "warehouse_agent"];

const ROLE_LABELS: Record<string, string> = {
  market_manager: "Market Manager",
  agent: "Agent de confirmation",
  warehouse_agent: "Agent entrepôt",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 36,
  padding: "0 12px",
  fontSize: 14,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  background: "white",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#374151",
  marginBottom: 6,
};

export function InviteUserPanel({ open, actorRole, actorMarketId, markets, onClose, onInvite }: Props) {
  const t = useTranslations("users");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [marketId, setMarketId] = useState(actorMarketId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const creatableRoles = actorRole === "super_admin" ? SUPER_ADMIN_CREATABLE : MANAGER_CREATABLE;

  useEffect(() => {
    if (open) {
      setUsername("");
      setRole("");
      setMarketId(actorMarketId ?? "");
      setError(null);
      setInviteLink(null);
      setCopied(false);
    }
  }, [open, actorMarketId]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !role) return;
    setLoading(true);
    setError(null);
    try {
      const payload: { username: string; role: string; market_id?: string } = { username, role };
      if (actorRole === "super_admin" && marketId) payload.market_id = marketId;
      const { inviteLink: link } = await onInvite(payload);
      setInviteLink(link);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 100,
        }}
      />

      <FocusTrap>
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("inviteTitle")}
          style={{
            position: "fixed",
            top: 0,
            insetInlineEnd: 0,
            width: 460,
            height: "100vh",
            background: "white",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
            zIndex: 101,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
                {t("inviteTitle")}
              </div>
              <div style={{ fontSize: 13, color: "#6D7175", marginTop: 2 }}>
                {t("inviteSubtitle")}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Fermer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "1px solid #E1E3E5",
                background: "white",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {inviteLink ? (
              <div>
                <div
                  style={{
                    padding: 12,
                    background: "#F0FDF4",
                    border: "1px solid #BBF7D0",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "#166534",
                    marginBottom: 16,
                  }}
                >
                  {t("inviteSent")}
                </div>
                <label style={labelStyle}>{t("inviteLinkLabel")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "#F4F4F4",
                      borderRadius: 6,
                      fontSize: 12,
                      wordBreak: "break-all",
                      display: "block",
                    }}
                  >
                    {inviteLink}
                  </code>
                  <button
                    onClick={handleCopy}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      background: copied ? "#F0FDF4" : "#1A1A1A",
                      color: copied ? "#166534" : "white",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? t("inviteLinkCopied") : t("inviteLinkCopy")}
                  </button>
                </div>
                <button
                  onClick={onClose}
                  style={{
                    marginTop: 20,
                    width: "100%",
                    padding: "10px 0",
                    background: "white",
                    border: "1px solid #E1E3E5",
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {t("cancel")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={labelStyle}>{t("username")}</label>
                  <input
                    ref={firstInputRef}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: ahmed ben ali"
                    required
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>{t("role")}</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    required
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    <option value="">Sélectionner un rôle</option>
                    {creatableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r] ?? r}
                      </option>
                    ))}
                  </select>
                </div>

                {actorRole === "super_admin" && (
                  <div>
                    <label style={labelStyle}>{t("market")}</label>
                    <select
                      value={marketId}
                      onChange={(e) => setMarketId(e.target.value)}
                      required
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="">Sélectionner un marché</option>
                      {markets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {error && (
                  <div
                    style={{
                      padding: "10px 12px",
                      background: "#FEF2F2",
                      border: "1px solid #FECACA",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "#B91C1C",
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !username || !role}
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    background: loading || !username || !role ? "#E1E3E5" : "#1A1A1A",
                    color: loading || !username || !role ? "#9CA3AF" : "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? t("inviting") : t("invite")}
                </button>
              </form>
            )}
          </div>
        </aside>
      </FocusTrap>
    </>
  );
}
