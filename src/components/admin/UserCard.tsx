"use client";

import React, { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal, History, KeyRound, UserX, UserCheck } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { getPresence, PRESENCE_COLOR } from "@/lib/presence";
import type { Role, UserWithStats } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  user: UserWithStats;
  markets: Market[];
  actorRole: Role;
  onDeactivate: () => void;
  onReactivate: () => void;
  onResetPassword: () => void;
  onViewAuditLog: () => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  return `il y a ${Math.floor(hrs / 24)} j`;
}

const ROLE_BADGE: Record<Role, { label: string; bg: string; color: string }> = {
  super_admin: { label: "Super Admin", bg: "#EEF2FF", color: "#4338CA" },
  market_manager: { label: "Manager", bg: "#F0FDF4", color: "#166534" },
  agent: { label: "Agent", bg: "#FFF7ED", color: "#9A3412" },
  warehouse_agent: { label: "Entrepôt", bg: "#F0F9FF", color: "#075985" },
};

export function UserCard({
  user,
  markets,
  actorRole,
  onDeactivate,
  onReactivate,
  onResetPassword,
  onViewAuditLog,
}: Props) {
  const t = useTranslations("users");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const presence = getPresence(user.last_seen_at);
  const presenceColor = PRESENCE_COLOR[presence];
  const marketName = markets.find((m) => m.id === user.market_id)?.name ?? "—";
  const badge = ROLE_BADGE[user.role];
  const isPending = !!user.invitation_sent_at && !user.invitation_accepted_at;
  const isDisabled = !user.is_active;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderBottom: "1px solid #E1E3E5",
        background: "white",
        position: "relative",
      }}
    >
      {/* Avatar + presence dot */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <Avatar user={user} size={36} />
        <span
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: presenceColor,
            border: "2px solid white",
          }}
        />
      </div>

      {/* Name + email + badges */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
            {user.full_name}
          </span>

          {/* Role badge */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 7px",
              borderRadius: 4,
              background: badge.bg,
              color: badge.color,
            }}
          >
            {badge.label}
          </span>

          {/* Market badge */}
          {user.market_id && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                padding: "2px 7px",
                borderRadius: 4,
                background: "#F4F4F4",
                color: "#374151",
              }}
            >
              {marketName}
            </span>
          )}

          {/* Invited badge */}
          {isPending && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "2px 7px",
                borderRadius: 4,
                background: "#FFFBEB",
                color: "#B45309",
              }}
            >
              {t("invitePending")}
            </span>
          )}

          {/* Disabled badge */}
          {isDisabled && !isPending && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                padding: "2px 7px",
                borderRadius: 4,
                background: "#F4F4F4",
                color: "#6B7280",
              }}
            >
              {t("sections.disabled")}
            </span>
          )}
        </div>

        <div style={{ fontSize: 13, color: "#6D7175", marginTop: 2 }}>
          {user.email}
          {user.last_seen_at && (
            <span style={{ marginInlineStart: 8, color: "#9CA3AF" }}>
              · {relativeTime(user.last_seen_at)}
            </span>
          )}
        </div>
      </div>

      {/* Stats chips */}
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {(user.orders_actioned ?? 0) > 0 && (
          <span style={{ fontSize: 12, color: "#6D7175", padding: "2px 8px", background: "#F4F4F4", borderRadius: 4 }}>
            {t("stats.ordersActioned", { count: user.orders_actioned! })}
          </span>
        )}
        {(user.leads_converted ?? 0) > 0 && (
          <span style={{ fontSize: 12, color: "#6D7175", padding: "2px 8px", background: "#F4F4F4", borderRadius: 4 }}>
            {t("stats.leadsConverted", { count: user.leads_converted! })}
          </span>
        )}
      </div>

      {/* Action menu */}
      <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          aria-label="Actions"
          onClick={() => setMenuOpen((o) => !o)}
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
          <MoreHorizontal size={16} color="#6D7175" />
        </button>

        {menuOpen && (
          <div
            style={{
              position: "absolute",
              insetInlineEnd: 0,
              top: 36,
              background: "white",
              border: "1px solid #E1E3E5",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              zIndex: 50,
              minWidth: 180,
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => { setMenuOpen(false); onResetPassword(); }}
              style={menuItemStyle}
            >
              <KeyRound size={14} />
              {t("resetPassword")}
            </button>

            {user.is_active ? (
              <button
                onClick={() => { setMenuOpen(false); onDeactivate(); }}
                style={{ ...menuItemStyle, color: "#B91C1C" }}
              >
                <UserX size={14} />
                {t("deactivate")}
              </button>
            ) : (
              <button
                onClick={() => { setMenuOpen(false); onReactivate(); }}
                style={{ ...menuItemStyle, color: "#166534" }}
              >
                <UserCheck size={14} />
                {t("reactivate")}
              </button>
            )}

            {actorRole === "super_admin" && (
              <button
                onClick={() => { setMenuOpen(false); onViewAuditLog(); }}
                style={menuItemStyle}
              >
                <History size={14} />
                {t("auditLog.title")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Permissions toggle */}
      <button
        onClick={() => setShowPermissions((o) => !o)}
        style={{
          position: "absolute",
          bottom: 4,
          insetInlineEnd: 56,
          fontSize: 11,
          color: "#9CA3AF",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {showPermissions ? "Masquer" : "Permissions"}
      </button>
    </div>
  );
}

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "10px 14px",
  fontSize: 14,
  color: "#1A1A1A",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "start",
};
