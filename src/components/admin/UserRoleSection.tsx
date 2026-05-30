"use client";

import { useTranslations } from "next-intl";
import { UserCard } from "./UserCard";
import type { Role, UserWithStats } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Props {
  role: Role;
  users: UserWithStats[];
  markets: Market[];
  actorRole: Role;
  actorId: string;
  onDeactivate: (user: UserWithStats) => void;
  onReactivate: (id: string) => void;
  onResetPassword: (user: UserWithStats) => void;
  onViewAuditLog: (id: string) => void;
  onDelete: (user: UserWithStats) => void;
}

function groupByStatus(users: UserWithStats[]) {
  const active: UserWithStats[] = [];
  const invited: UserWithStats[] = [];
  const disabled: UserWithStats[] = [];

  for (const u of users) {
    if (!u.is_active && u.invitation_sent_at && !u.invitation_accepted_at) {
      invited.push(u);
    } else if (!u.is_active) {
      disabled.push(u);
    } else {
      active.push(u);
    }
  }

  return { active, invited, disabled };
}

export function UserRoleSection({
  role,
  users,
  markets,
  actorRole,
  actorId,
  onDeactivate,
  onReactivate,
  onResetPassword,
  onViewAuditLog,
  onDelete,
}: Props) {
  const t = useTranslations("users");
  const { active, invited, disabled } = groupByStatus(users);

  const roleLabelKey = `sections.${role}` as Parameters<typeof t>[0];

  const renderGroup = (label: string, group: UserWithStats[]) => {
    if (group.length === 0) return null;
    return (
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#9CA3AF",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "8px 16px 4px",
            background: "#FAFAFA",
          }}
        >
          {label}
        </div>
        {group.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            markets={markets}
            actorRole={actorRole}
            actorId={actorId}
            onDeactivate={() => onDeactivate(u)}
            onReactivate={() => onReactivate(u.id)}
            onResetPassword={() => onResetPassword(u)}
            onViewAuditLog={() => onViewAuditLog(u.id)}
            onDelete={() => onDelete(u)}
          />
        ))}
      </div>
    );
  };

  return (
    <section style={{ marginBottom: 24 }}>
      {/* Role group header */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#374151",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "16px 16px 8px",
          borderBottom: "1px solid #E1E3E5",
          background: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{t(roleLabelKey)}</span>
        <span style={{ fontSize: 11, fontWeight: 400, color: "#9CA3AF", textTransform: "none" }}>
          {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <div style={{ padding: "16px", fontSize: 14, color: "#9CA3AF", textAlign: "center", background: "white" }}>
          {t("empty")}
        </div>
      ) : (
        <>
          {renderGroup(t("sections.active"), active)}
          {renderGroup(t("sections.invited"), invited)}
          {renderGroup(t("sections.disabled"), disabled)}
        </>
      )}
    </section>
  );
}
