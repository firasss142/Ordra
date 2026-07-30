"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useUsersWorkspace } from "@/hooks/useUsersWorkspace";
import { UserRoleSection } from "@/components/admin/UserRoleSection";
import { CreateUserPanel } from "@/components/admin/CreateUserPanel";
import { DeactivateUserFlow } from "@/components/admin/DeactivateUserFlow";
import { DeleteUserFlow } from "@/components/admin/DeleteUserFlow";
import { UserAuditLog } from "@/components/admin/UserAuditLog";
import type { AuthUser, DeactivationReason, Role, UserWithStats } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  user: AuthUser;
}

const ROLE_ORDER: Role[] = [
  "super_admin",
  "market_manager",
  "agent",
  "warehouse_agent",
  "investor",
];

function groupUsersByRole(users: UserWithStats[]): Partial<Record<Role, UserWithStats[]>> {
  const map: Partial<Record<Role, UserWithStats[]>> = {};
  for (const u of users) {
    if (!map[u.role]) map[u.role] = [];
    map[u.role]!.push(u);
  }
  return map;
}

export function UsersPageClient({ user }: Props) {
  const t = useTranslations("users");
  const { users, isLoading, createUser, deactivateUser, reactivateUser, deleteUser } = useUsersWorkspace();
  const { data: marketsData } = useSWR<{ data: Market[] }>(
    user.role === "super_admin" ? "/api/markets" : null,
    fetcher
  );

  const markets = useMemo((): Market[] => {
    if (marketsData?.data) return marketsData.data;
    if (user.market_id) {
      return [{ id: user.market_id, name: user.market_id, code: "" }];
    }
    return [];
  }, [marketsData, user.market_id]);

  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [deactivatingUser, setDeactivatingUser] = useState<UserWithStats | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserWithStats | null>(null);
  const [auditLogUserId, setAuditLogUserId] = useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithStats | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const grouped = useMemo(() => groupUsersByRole(users), [users]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
            ACCÈS
          </h1>
          <p style={{ fontSize: 14, color: "#6D7175", margin: "4px 0 0" }}>
            Gestion des utilisateurs et des accès
          </p>
        </div>

        {(user.role === "super_admin" || user.role === "market_manager") && (
          <button
            onClick={() => setCreatePanelOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 18px",
              background: "#1A1A1A",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("createTitle")}
          </button>
        )}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div style={{ textAlign: "center", color: "#9CA3AF", fontSize: 14, padding: 48 }}>
          Chargement…
        </div>
      )}

      {/* Role sections */}
      {!isLoading &&
        ROLE_ORDER.map((role) => {
          const roleUsers = grouped[role];
          if (!roleUsers || roleUsers.length === 0) return null;
          return (
            <UserRoleSection
              key={role}
              role={role}
              users={roleUsers}
              markets={markets}
              actorRole={user.role}
              actorId={user.id}
              onDeactivate={(u) => setDeactivatingUser(u)}
              onReactivate={async (id) => {
                try {
                  await reactivateUser(id);
                  showToast(t("reactivate") + " ✓");
                } catch (e: unknown) {
                  showToast(e instanceof Error ? e.message : "Erreur");
                }
              }}
              onResetPassword={(u) => setResetPasswordUser(u)}
              onViewAuditLog={(id) => setAuditLogUserId(id)}
              onDelete={(u) => setDeletingUser(u)}
            />
          );
        })}

      {/* Create panel */}
      <CreateUserPanel
        open={createPanelOpen}
        actorRole={user.role}
        actorMarketId={user.market_id}
        markets={markets}
        onClose={() => setCreatePanelOpen(false)}
        onCreate={async (payload) => {
          await createUser(payload);
          showToast(t("create") + " ✓");
        }}
      />

      {/* Deactivate flow */}
      {deactivatingUser && (
        <DeactivateUserFlow
          userId={deactivatingUser.id}
          userName={deactivatingUser.full_name}
          open={!!deactivatingUser}
          onClose={() => setDeactivatingUser(null)}
          onDeactivate={async (id, reason: DeactivationReason) => {
            return deactivateUser(id, reason);
          }}
          onSuccess={(ordersReturned) => {
            setDeactivatingUser(null);
            showToast(t("deactivatedWithCount", { count: ordersReturned }));
          }}
        />
      )}

      {/* Delete flow (super_admin only — gating enforced in UserCard) */}
      {deletingUser && (
        <DeleteUserFlow
          userId={deletingUser.id}
          userName={deletingUser.full_name}
          open={!!deletingUser}
          onClose={() => setDeletingUser(null)}
          onDelete={async (id) => deleteUser(id)}
          onSuccess={(ordersReturned) => {
            setDeletingUser(null);
            showToast(t("deletedWithCount", { count: ordersReturned }));
          }}
        />
      )}

      {/* Audit log */}
      {auditLogUserId && (
        <UserAuditLog
          userId={auditLogUserId}
          open={!!auditLogUserId}
          onClose={() => setAuditLogUserId(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            insetInlineEnd: 24,
            background: "#1A1A1A",
            color: "white",
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 14,
            zIndex: 999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          }}
        >
          {toast}
        </div>
      )}

      {/* Reset password stub (handled inline) */}
      {resetPasswordUser && (
        <ResetPasswordDialog
          user={resetPasswordUser}
          onClose={() => setResetPasswordUser(null)}
          onSuccess={() => {
            setResetPasswordUser(null);
            showToast(t("passwordReset"));
          }}
        />
      )}
    </div>
  );
}

// Inline reset password dialog — simple, no separate file needed
function ResetPasswordDialog({
  user,
  onClose,
  onSuccess,
}: {
  user: UserWithStats;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("users");
  const { resetPassword } = useUsersWorkspace();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const invalid = false;
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setError(t("passwordMismatch")); return; }
    if (pw.length < 1) { setError(t("passwordTooShort")); return; }
    setLoading(true);
    setError(null);
    try {
      await resetPassword(user.id, pw);
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "white",
          borderRadius: 12,
          width: 400,
          maxWidth: "90vw",
          zIndex: 201,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
          {t("resetPassword")}
        </h2>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "0 0 20px" }}>
          {user.full_name}
        </p>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              {t("newPassword")}
            </label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
              style={{
                display: "block", width: "100%", height: 36, padding: "0 12px",
                fontSize: 14, border: `1px solid ${invalid ? "#FECACA" : "#E1E3E5"}`,
                borderRadius: 6, outline: "none", boxSizing: "border-box",
              }}
            />
            {invalid && <p style={{ fontSize: 12, color: "#B91C1C", margin: "4px 0 0" }}>{t("passwordTooShort")}</p>}
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              {t("confirmPassword")}
            </label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
              style={{
                display: "block", width: "100%", height: 36, padding: "0 12px",
                fontSize: 14, border: `1px solid ${mismatch ? "#FECACA" : "#E1E3E5"}`,
                borderRadius: 6, outline: "none", boxSizing: "border-box",
              }}
            />
            {mismatch && <p style={{ fontSize: 12, color: "#B91C1C", margin: "4px 0 0" }}>{t("passwordMismatch")}</p>}
          </div>
          {error && (
            <p style={{ fontSize: 13, color: "#B91C1C", padding: "8px 12px", background: "#FEF2F2", borderRadius: 6, margin: 0 }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: "10px 0", background: "white", border: "1px solid #E1E3E5", borderRadius: 6, fontSize: 14, cursor: "pointer" }}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ flex: 1, padding: "10px 0", background: loading ? "#E1E3E5" : "#1A1A1A", color: loading ? "#9CA3AF" : "white", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer" }}
            >
              {loading ? "Enregistrement…" : t("save")}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
