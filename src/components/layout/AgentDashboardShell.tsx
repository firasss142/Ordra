"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useBroadcastConnected } from "@/components/providers/RealtimeProvider";
import { ordersTopic } from "@/hooks/useOrdersRealtime";
import { Topbar } from "./Topbar";
import { AgentNavTabs } from "./AgentNavTabs";
import { AgentTabsContainer } from "./AgentTabsContainer";
import { NotificationBell } from "./NotificationBell";
import { AgentAvailabilityToggle } from "./AgentAvailabilityToggle";
import { QueueSearchBar } from "@/components/queue/QueueSearchBar";
import { QueueSearchProvider } from "@/context/queue-search";
import { FeedbackCaptureProvider } from "@/components/feedback/FeedbackCaptureProvider";
import type { AuthUser } from "@/types";

export function AgentDashboardShell({
  user,
  children,
}: {
  user: AuthUser;
  children?: React.ReactNode;
}) {
  const isRtl = user.direction === "rtl";
  usePathname();

  const actions = useMemo(
    () => <NotificationBell agentId={user.id} />,
    [user.id],
  );

  // The status slot now answers "am I being given work", not "is the socket
  // up". The connection is still shown, as the sub-line of the readiness
  // control — it is the answer to a different question and never deserved
  // equal billing with a second green dot.
  const live = useBroadcastConnected(user.market_id ? [ordersTopic(user.market_id)] : []);
  const status = <AgentAvailabilityToggle live={live} />;

  return (
    <QueueSearchProvider>
      <FeedbackCaptureProvider role={user.role}>
      <div
        className="agent-theme"
        style={{
          minHeight: "100vh",
          backgroundColor: "var(--agent-bg)",
          direction: isRtl ? "rtl" : "ltr",
        }}
      >
        {/* On mobile only the topbar (search / avatar / bell) pins to the top
            so it stays reachable while scrolling. The nav tabs scroll away with
            the content. Desktop keeps its original static flow. */}
        <div className="max-sm:sticky max-sm:top-0 max-sm:z-40 max-sm:bg-agent-surface">
          <Topbar
            user={user}
            marketName=""
            actions={actions}
            variant="agent"
            // Desktop folds navigation into the header row; the standalone band
            // below is mobile-only. Two chrome bands cost ~56px of every screen
            // to hold one search field and three links.
            navSlot={<AgentNavTabs user={user} variant="inline" />}
            // Rendered on every tab: the field used to appear only on the
            // queue, so the whole trailing cluster shifted on each tab change.
            // It now predicts across orders, delivery and prospects alike.
            searchSlot={<QueueSearchBar variant="navbar" />}
            statusSlot={status}
          />
        </div>
        {/* Phones get the bottom tab bar; the padding keeps the last row above it. */}
        <div className="pb-[72px] lg:pb-0">
          <AgentTabsContainer user={user}>{children}</AgentTabsContainer>
        </div>
        <AgentNavTabs user={user} />
      </div>
      </FeedbackCaptureProvider>
    </QueueSearchProvider>
  );
}
