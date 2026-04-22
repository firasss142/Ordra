"use client";

import { memo } from "react";
import { usePathname } from "next/navigation";
import { QueuePage } from "@/components/queue/QueuePage";
import { AgentLeadsQueue } from "@/components/crm/AgentLeadsQueue";
import { FollowUpsBoard } from "@/components/follow-ups/FollowUpsBoard";
import type { AuthUser } from "@/types";

type Tab = "queue" | "leads" | "follow-ups";

function resolveActiveTab(pathname: string): Tab {
  if (pathname.includes("/follow-ups")) return "follow-ups";
  if (pathname.includes("/leads")) return "leads";
  return "queue";
}

function AgentTabsContainerInner({ user }: { user: AuthUser }) {
  const pathname = usePathname();
  const active = resolveActiveTab(pathname);
  const marketCode: "TN" | "LY" = user.locale === "ar" ? "LY" : "TN";

  return (
    <main id="main-content">
      <div
        style={{ display: active === "queue" ? "block" : "none" }}
        aria-hidden={active !== "queue"}
      >
        <QueuePage />
      </div>
      <div
        style={{ display: active === "leads" ? "block" : "none" }}
        aria-hidden={active !== "leads"}
      >
        <AgentLeadsQueue user={user} />
      </div>
      <div
        style={{ display: active === "follow-ups" ? "block" : "none" }}
        aria-hidden={active !== "follow-ups"}
      >
        <FollowUpsBoard user={user} marketCode={marketCode} />
      </div>
    </main>
  );
}

export const AgentTabsContainer = memo(AgentTabsContainerInner);
