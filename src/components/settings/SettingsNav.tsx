"use client";

import type { Role } from "@/types";

type Section = {
  key: string;
  label: string;
};

const SUPER_ADMIN_SECTIONS: Section[] = [
  { key: "general", label: "Paramètres généraux" },
  { key: "carriers", label: "Transporteurs" },
  { key: "storefronts", label: "Storefronts" },
  { key: "markets", label: "Marchés" },
];

const MARKET_MANAGER_SECTIONS: Section[] = [
  { key: "general", label: "Paramètres généraux" },
];

interface SettingsNavProps {
  role: Role;
  activeSection: string;
  isRtl?: boolean;
}

export function SettingsNav({ role, activeSection, isRtl = false }: SettingsNavProps) {
  if (role === "agent") return null;

  const sections =
    role === "super_admin" ? SUPER_ADMIN_SECTIONS : MARKET_MANAGER_SECTIONS;

  return (
    <nav style={{ width: 200, flexShrink: 0 }}>
      {sections.map((section) => {
        const isActive = section.key === activeSection;
        return (
          <a
            key={section.key}
            href={`?section=${section.key}`}
            aria-current={isActive ? "page" : undefined}
            style={{
              display: "block",
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? "#1A1A1A" : "#6B7280",
              textDecoration: "none",
              borderLeft: !isRtl && isActive ? "2px solid #1A1A1A" : undefined,
              borderRight: isRtl && isActive ? "2px solid #1A1A1A" : undefined,
              borderLeftWidth: !isRtl && !isActive ? 2 : undefined,
              borderLeftColor: !isRtl && !isActive ? "transparent" : undefined,
              borderRightWidth: isRtl && !isActive ? 2 : undefined,
              borderRightColor: isRtl && !isActive ? "transparent" : undefined,
            }}
          >
            {section.label}
          </a>
        );
      })}
    </nav>
  );
}
