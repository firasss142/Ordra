"use client";

import { useMemo } from "react";
import { Topbar } from "./Topbar";
import { AgentNavTabs } from "./AgentNavTabs";
import { AgentTabsContainer } from "./AgentTabsContainer";
import { NotificationBell } from "./NotificationBell";
import type { AuthUser } from "@/types";

export function AgentDashboardShell({ user }: { user: AuthUser }) {
  const isRtl = user.direction === "rtl";
  const actions = useMemo(
    () => <NotificationBell agentId={user.id} />,
    [user.id],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--bg-page)",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <Topbar user={user} marketName="" actions={actions} />
      <AgentNavTabs user={user} />
      <AgentTabsContainer user={user} />
    </div>
  );
}
