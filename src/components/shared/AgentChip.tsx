"use client";

import { Avatar } from "@/components/ui/Avatar";

interface AgentChipProps {
  fullName: string;
  avatarUrl: string | null;
  size?: number;
  children?: React.ReactNode;
}

export function AgentChip({ fullName, avatarUrl, size = 28, children }: AgentChipProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <Avatar user={{ full_name: fullName, avatar_url: avatarUrl }} size={size} />
      <span>{fullName}</span>
      {children}
    </span>
  );
}
