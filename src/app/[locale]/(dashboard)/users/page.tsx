"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { useAuth } from "@/context/auth";
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

const SUPER_ADMIN_CREATABLE: Role[] = [
  "market_manager",
  "agent",
  "warehouse_agent",
];
const MANAGER_CREATABLE: Role[] = ["agent", "warehouse_agent"];

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
  marginInlineEnd: 12,
};

export default function UsersPage() {
  const { user } = useAuth();
  const t = useTranslations("users");
  const tNav = useTranslations("nav");

  const creatableRoles =
    user?.role === "super_admin" ? SUPER_ADMIN_CREATABLE : MANAGER_CREATABLE;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [marketId, setMarketId] = useState<string>("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(
    null,
  );
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPwForm, setResetPwForm] = useState({
    newPassword: "",
    confirmPassword: "",
  });
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowSuccess, setRowSuccess] = useState<string | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, []);

  function flashSuccess(msg: string) {
    setRowSuccess(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setRowSuccess(null), 3000);
  }

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    user?.role === "super_admin" ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  useEffect(() => {
    if (user?.role === "super_admin") {
      if (!marketId && markets.length > 0) setMarketId(markets[0].id);
    } else if (user?.role === "market_manager") {
      setMarketId(user.market_id ?? "");
    }
  }, [user, markets, marketId]);

  const { data: usersData, mutate } = useSWR<{ data: UserRow[] }>(
    user && (user.role === "super_admin" || user.role === "market_manager")
      ? "/api/users"
      : null,
    fetcher,
  );
  const users = usersData?.data ?? [];

  if (!user) return null;
  if (user.role !== "super_admin" && user.role !== "market_manager") {
    return null;
  }

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

    if (!username.trim() || !password) {
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
          role,
          market_id: marketId || undefined,
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
      setRole(creatableRoles[0]);
      setAvatar(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await mutate();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(userId: string) {
    setRowError(null);
    const res = await fetch(`/api/agents/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deactivate" }),
    });
    if (res.ok) {
      setConfirmDeactivateId(null);
      flashSuccess(t("deactivated"));
      mutate();
    } else {
      const b = await res.json().catch(() => ({}));
      setRowError((b as { error?: string }).error ?? "Erreur");
    }
  }

  async function handleReactivate(userId: string) {
    setRowError(null);
    const res = await fetch(`/api/agents/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reactivate" }),
    });
    if (res.ok) {
      mutate();
    } else {
      const b = await res.json().catch(() => ({}));
      setRowError((b as { error?: string }).error ?? "Erreur");
    }
  }

  async function handleResetPassword(e: React.FormEvent, userId: string) {
    e.preventDefault();
    setRowError(null);

    if (resetPwForm.newPassword.length < 8) {
      setRowError(t("passwordTooShort"));
      return;
    }
    if (resetPwForm.newPassword !== resetPwForm.confirmPassword) {
      setRowError(t("passwordMismatch"));
      return;
    }

    const res = await fetch(`/api/agents/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset_password",
        new_password: resetPwForm.newPassword,
      }),
    });

    if (res.ok) {
      setResetPasswordId(null);
      setResetPwForm({ newPassword: "", confirmPassword: "" });
      flashSuccess(t("passwordReset"));
    } else {
      const b = await res.json().catch(() => ({}));
      setRowError((b as { error?: string }).error ?? "Erreur");
    }
  }

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "#1A1A1A",
          margin: "0 0 24px 0",
        }}
      >
        {tNav("users")}
      </h1>

      {/* Create form */}
      <div
        style={{
          backgroundColor: "white",
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          padding: 20,
          marginBottom: 24,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#1A1A1A",
            margin: "0 0 16px 0",
          }}
        >
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
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                style={inputStyle}
              >
                {creatableRoles.map((r) => (
                  <option key={r} value={r}>
                    {tNav(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>

            {user.role === "super_admin" && (
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
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar
              user={{ full_name: username || "?", avatar_url: avatar }}
              size={40}
            />
            <label style={{ fontSize: 13, color: "#2C6ECB", cursor: "pointer" }}>
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
              <span style={{ color: "#D72C0D", fontSize: 13 }}>
                {avatarError}
              </span>
            )}
          </div>

          {formError && (
            <p style={{ color: "#D72C0D", fontSize: 13, margin: 0 }}>
              {formError}
            </p>
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

      {/* Flash messages */}
      {rowSuccess && (
        <p style={{ fontSize: 13, color: "#008060", margin: "0 0 12px 0" }}>
          {rowSuccess}
        </p>
      )}
      {rowError && (
        <p style={{ fontSize: 13, color: "#D72C0D", margin: "0 0 12px 0" }}>
          {rowError}
        </p>
      )}

      {/* Users list */}
      <div
        style={{
          backgroundColor: "white",
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
              {user.role === "super_admin" && (
                <th style={thStyle}>{t("columns.market")}</th>
              )}
              <th style={thStyle}>{t("columns.status")}</th>
              <th style={thStyle}>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const columns = user.role === "super_admin" ? 5 : 4;
              return (
                <React.Fragment key={u.id}>
                  <tr>
                    <td style={tdStyle}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <Avatar user={u} size={28} />
                        <div
                          style={{ display: "flex", flexDirection: "column" }}
                        >
                          <span style={{ fontWeight: 500 }}>{u.full_name}</span>
                          <span
                            style={{ fontSize: 12, color: "#6D7175" }}
                          >
                            {u.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>{tNav(`roles.${u.role}`)}</td>
                    {user.role === "super_admin" && (
                      <td style={tdStyle}>{marketName(u.market_id)}</td>
                    )}
                    <td style={tdStyle}>
                      <span
                        style={{
                          color: u.is_active ? "#008060" : "#6D7175",
                          fontSize: 16,
                        }}
                        title={u.is_active ? "Actif" : "Inactif"}
                      >
                        ●
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => {
                          if (resetPasswordId === u.id) {
                            setResetPasswordId(null);
                          } else {
                            setResetPasswordId(u.id);
                            setResetPwForm({
                              newPassword: "",
                              confirmPassword: "",
                            });
                            setRowError(null);
                          }
                        }}
                        style={linkBtnStyle}
                      >
                        {t("resetPassword")}
                      </button>
                      {u.is_active ? (
                        <button
                          onClick={() => {
                            setConfirmDeactivateId(u.id);
                            setRowError(null);
                          }}
                          style={linkBtnStyle}
                        >
                          {t("deactivate")}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(u.id)}
                          style={linkBtnStyle}
                        >
                          {t("reactivate")}
                        </button>
                      )}
                    </td>
                  </tr>

                  {confirmDeactivateId === u.id && (
                    <tr key={`${u.id}-confirm`}>
                      <td
                        colSpan={columns}
                        style={{
                          padding: "12px 16px",
                          backgroundColor: "#F6F6F7",
                          borderBottom: "1px solid #E1E3E5",
                          fontSize: 14,
                        }}
                      >
                        <span
                          style={{ color: "#1A1A1A", marginInlineEnd: 16 }}
                        >
                          {t("confirmDeactivate", { name: u.full_name })}
                        </span>
                        <button
                          onClick={() => handleDeactivate(u.id)}
                          style={{
                            backgroundColor: "#1A1A1A",
                            color: "white",
                            border: "none",
                            borderRadius: "0.5rem",
                            padding: "6px 12px",
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: "pointer",
                            marginInlineEnd: 8,
                          }}
                        >
                          {t("confirm")}
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
                          {t("cancel")}
                        </button>
                      </td>
                    </tr>
                  )}

                  {resetPasswordId === u.id && (
                    <tr key={`${u.id}-reset`}>
                      <td
                        colSpan={columns}
                        style={{
                          padding: "12px 16px",
                          backgroundColor: "#F6F6F7",
                          borderBottom: "1px solid #E1E3E5",
                        }}
                      >
                        <form
                          onSubmit={(e) => handleResetPassword(e, u.id)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                            maxWidth: 360,
                          }}
                        >
                          <div>
                            <label
                              htmlFor={`new-pw-${u.id}`}
                              style={labelStyle}
                            >
                              {t("newPassword")}
                            </label>
                            <input
                              id={`new-pw-${u.id}`}
                              type="password"
                              value={resetPwForm.newPassword}
                              onChange={(e) =>
                                setResetPwForm((f) => ({
                                  ...f,
                                  newPassword: e.target.value,
                                }))
                              }
                              style={inputStyle}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`confirm-pw-${u.id}`}
                              style={labelStyle}
                            >
                              {t("confirmPassword")}
                            </label>
                            <input
                              id={`confirm-pw-${u.id}`}
                              type="password"
                              value={resetPwForm.confirmPassword}
                              onChange={(e) =>
                                setResetPwForm((f) => ({
                                  ...f,
                                  confirmPassword: e.target.value,
                                }))
                              }
                              style={inputStyle}
                            />
                          </div>
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
                              {t("save")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setResetPasswordId(null)}
                              style={{
                                background: "none",
                                border: "none",
                                color: "#1A1A1A",
                                fontSize: 13,
                                cursor: "pointer",
                                padding: 0,
                              }}
                            >
                              {t("cancel")}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={user.role === "super_admin" ? 5 : 4}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    color: "#6D7175",
                    padding: 32,
                  }}
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
