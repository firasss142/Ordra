"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Topbar } from "./Topbar";
import { AgentNavTabs } from "./AgentNavTabs";
import { AgentTabsContainer } from "./AgentTabsContainer";
import { NotificationBell } from "./NotificationBell";
import { QueueSearchBar } from "@/components/queue/QueueSearchBar";
import { QueueSearchProvider } from "@/context/queue-search";
import type { AuthUser } from "@/types";

export function AgentDashboardShell({
  user,
  children,
}: {
  user: AuthUser;
  children?: React.ReactNode;
}) {
  const isRtl = user.direction === "rtl";
  const pathname = usePathname();
  // The navbar search only drives the order queue, so show it on that tab only.
  const onQueueTab = !pathname.includes("/leads") && !pathname.includes("/follow-ups");

  const actions = useMemo(
    () => <NotificationBell agentId={user.id} />,
    [user.id],
  );

  return (
    <QueueSearchProvider>
      <div
        className="agent-theme"
        style={{
          minHeight: "100vh",
          backgroundColor: "var(--agent-bg)",
          direction: isRtl ? "rtl" : "ltr",
        }}
      >
        <Topbar
          user={user}
          marketName=""
          actions={actions}
          variant="agent"
          searchSlot={onQueueTab ? <QueueSearchBar variant="navbar" /> : null}
        />
        <AgentNavTabs user={user} />
        <AgentTabsContainer user={user}>{children}</AgentTabsContainer>
      </div>
    </QueueSearchProvider>
  );
}
