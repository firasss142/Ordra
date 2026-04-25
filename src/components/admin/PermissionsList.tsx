"use client";

import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { getPermissionsForRole } from "@/lib/user-permissions";
import type { Role } from "@/types";

interface Props {
  role: Role;
}

export function PermissionsList({ role }: Props) {
  const t = useTranslations("permissions");
  const items = getPermissionsForRole(role);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px 24px",
        padding: "12px 0",
      }}
    >
      {items.map((item) => (
        <div
          key={item.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            color: item.allowed ? "#1A1A1A" : "#9CA3AF",
          }}
        >
          {item.allowed ? (
            <Check size={14} strokeWidth={2} color="#008060" />
          ) : (
            <X size={14} strokeWidth={2} color="#9CA3AF" />
          )}
          {t(item.key as Parameters<typeof t>[0])}
        </div>
      ))}
    </div>
  );
}
