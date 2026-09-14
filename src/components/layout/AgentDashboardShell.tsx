"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useBroadcastConnected } from "@/components/providers/RealtimeProvider";
import { ordersTopic } from "@/hooks/useOrdersRealtime";
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
  const onQueueTab = !pathname.includes("/leads") && !pathname.includes("/follow-ups") && !pathname.includes("/delivery") && !pathname.includes("/commissions");

  const actions = useMemo(
    () => <NotificationBell agentId={user.id} />,
    [user.id],
  );

  // Whether the order channel is live. Offline, the page keeps polling and
  // queued actions still post; the header says so.
  const t = useTranslations("delivery.shell");
  const live = useBroadcastConnected(user.market_id ? [ordersTopic(user.market_id)] : []);
  const status = (
    <div className={`flex flex-col items-center rounded-xl px-2.5 py-1 leading-tight ${live ? "bg-[#F0FDF4]" : "bg-[#FEF2F2]"} md:items-start md:bg-transparent md:px-0 md:py-0`}>
      <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold md:text-[13px] ${live ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${live ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
        {live ? t("online") : t("offline")}
      </span>
      <span className="text-[10px] text-agent-ink-3 md:text-[11px]">{live ? t("onlineSub") : t("offlineSub")}</span>
    </div>
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
            searchSlot={onQueueTab ? <QueueSearchBar variant="navbar" /> : null}
            statusSlot={status}
          />
        </div>
        {/* Phones get the bottom tab bar; the padding keeps the last row above it. */}
        <div className="pb-[72px] lg:pb-0">
          <AgentTabsContainer user={user}>{children}</AgentTabsContainer>
        </div>
        <AgentNavTabs user={user} />
      </div>
    </QueueSearchProvider>
  );
}
