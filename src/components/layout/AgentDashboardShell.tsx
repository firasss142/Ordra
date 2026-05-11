"use client";

import { useMemo } from "react";
import { Topbar } from "./Topbar";
import { AgentNavTabs } from "./AgentNavTabs";
import { AgentTabsContainer } from "./AgentTabsContainer";
import { NotificationBell } from "./NotificationBell";
import type { AuthUser } from "@/types";

export function AgentDashboardShell({
  user,
  children,
}: {
  user: AuthUser;
  children?: React.ReactNode;
}) {
  const isRtl = user.direction === "rtl";
  const actions = useMemo(
    () => <NotificationBell agentId={user.id} />,
    [user.id],
  );

  return (
    <div
      className="agent-theme"
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--agent-bg)",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <Topbar user={user} marketName="" actions={actions} variant="agent" />
      <AgentNavTabs user={user} />
      <AgentTabsContainer user={user}>{children}</AgentTabsContainer>
    </div>
  );
}
