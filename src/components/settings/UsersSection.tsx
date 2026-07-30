"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { Avatar } from "@/components/ui/Avatar";
import { decodeAvatarFile, avatarErrorMessage } from "@/lib/client/image";
import type { Role } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Market {
  id: string;
  name: string;
  code: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: Role;
  market_id: string | null;
  is_active: boolean;
  created_at: string;
}

const CREATABLE_ROLES: Role[] = [
  "market_manager",
  "agent",
  "warehouse_agent",
  "investor",
];

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

interface UsersSectionProps {
  role: Role;
}

export function UsersSection({ role }: UsersSectionProps) {
  const t = useTranslations("users");
  const tNav = useTranslations("nav");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userRole, setUserRole] = useState<Role>("agent");
  const [marketId, setMarketId] = useState<string>("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    role === "super_admin" ? "/api/markets" : null,
    fetcher
  );
  const markets = marketsData?.data ?? [];

  useEffect(() => {
    if (!marketId && markets.length > 0) setMarketId(markets[0].id);
  }, [markets, marketId]);

  const { data: usersData, mutate } = useSWR<{ data: UserRow[] }>(
    role === "super_admin" ? "/api/users" : null,
    fetcher
  );
  const users = usersData?.data ?? [];

  if (role !== "super_admin") return null;

  const marketName = (id: string | null) =>
    markets.find((m) => m.id === id)?.name ?? "—";

  async function handleAvatarPick(file: File) {
    setAvatarError(null);
    const result = await decodeAvatarFile(file);
    if (!result.ok) {
      setAvatarError(avatarErrorMessage(result.error));
      return;
    }
    setAvatar(result.dataUrl);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!username.trim() || !password || !marketId) {
      setFormError(t("missingFields"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          role: userRole,
          market_id: marketId,
          avatar,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setFormError(json.error ?? t("genericError"));
        return;
      }

      setUsername("");
      setPassword("");
      setUserRole("agent");
      setAvatar(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await mutate();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Create form */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: "0 0 16px 0" }}>
          {t("createTitle")}
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
            }}
          >
            <div>
              <label style={labelStyle} htmlFor="new-username">
                {t("username")}
              </label>
              <input
                id="new-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="new-password">
                {t("password")}
              </label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="new-role">
                {t("role")}
              </label>
              <select
                id="new-role"
                value={userRole}
                onChange={(e) => setUserRole(e.target.value as Role)}
                style={inputStyle}
              >
                {CREATABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {tNav(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle} htmlFor="new-market">
                {t("market")}
              </label>
              <select
                id="new-market"
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                style={inputStyle}
                required
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar
              user={{ full_name: username || "?", avatar_url: avatar }}
              size={40}
            />
            <label
              style={{
                fontSize: 13,
                color: "#2C6ECB",
                cursor: "pointer",
              }}
            >
              {avatar ? t("changePhoto") : t("addPhoto")}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarPick(f);
                }}
              />
            </label>
            {avatar && (
              <button
                type="button"
                onClick={() => {
                  setAvatar(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6D7175",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {t("removePhoto")}
              </button>
            )}
            {avatarError && (
              <span style={{ color: "#D72C0D", fontSize: 13 }}>{avatarError}</span>
            )}
          </div>

          {formError && (
            <p style={{ color: "#D72C0D", fontSize: 13, margin: 0 }}>{formError}</p>
          )}

          <div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 36,
                padding: "0 16px",
                backgroundColor: submitting ? "#6D7175" : "#1A1A1A",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: 14,
                fontWeight: 500,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? t("creating") : t("create")}
            </button>
          </div>
        </form>
      </div>

      {/* Users list */}
      <div
        style={{
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("columns.user")}</th>
              <th style={thStyle}>{t("columns.role")}</th>
              <th style={thStyle}>{t("columns.market")}</th>
              <th style={thStyle}>{t("columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={tdStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar user={u} size={28} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 500 }}>{u.full_name}</span>
                      <span style={{ fontSize: 12, color: "#6D7175" }}>{u.email}</span>
                    </div>
                  </div>
                </td>
                <td style={tdStyle}>{tNav(`roles.${u.role}`)}</td>
                <td style={tdStyle}>{marketName(u.market_id)}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      color: u.is_active ? "#008060" : "#6D7175",
                      fontSize: 16,
                    }}
                  >
                    ●
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  style={{ ...tdStyle, textAlign: "center", color: "#6D7175", padding: 32 }}
                >
                  {t("empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
