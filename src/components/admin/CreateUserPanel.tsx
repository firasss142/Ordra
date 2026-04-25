"use client";

import React, { useEffect, useRef, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
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
  onCreate: (payload: {
    username: string;
    password: string;
    role: string;
    market_id?: string;
  }) => Promise<void>;
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

export function CreateUserPanel({ open, actorRole, actorMarketId, markets, onClose, onCreate }: Props) {
  const t = useTranslations("users");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [marketId, setMarketId] = useState(actorMarketId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const creatableRoles = actorRole === "super_admin" ? SUPER_ADMIN_CREATABLE : MANAGER_CREATABLE;

  useEffect(() => {
    if (open) {
      setUsername("");
      setPassword("");
      setRole("");
      setMarketId(actorMarketId ?? "");
      setError(null);
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
    if (!username || !password || !role) return;
    setLoading(true);
    setError(null);
    try {
      const payload: { username: string; password: string; role: string; market_id?: string } = {
        username,
        password,
        role,
      };
      if (actorRole === "super_admin" && marketId) payload.market_id = marketId;
      await onCreate(payload);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const submitDisabled = loading || !username || !password || !role;

  return (
    <>
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
          aria-label={t("createTitle")}
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
                {t("createTitle")}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={t("cancel")}
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

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
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
                <label style={labelStyle}>{t("password")}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={1}
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
                disabled={submitDisabled}
                style={{
                  width: "100%",
                  padding: "10px 0",
                  background: submitDisabled ? "#E1E3E5" : "#1A1A1A",
                  color: submitDisabled ? "#9CA3AF" : "white",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? t("creating") : t("create")}
              </button>
            </form>
          </div>
        </aside>
      </FocusTrap>
    </>
  );
}
