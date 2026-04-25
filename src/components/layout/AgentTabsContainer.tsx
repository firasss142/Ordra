"use client";

import { memo } from "react";
import { usePathname } from "next/navigation";
import { QueuePage } from "@/components/queue/QueuePage";
import { AgentLeadsQueue } from "@/components/crm/AgentLeadsQueue";
import type { AuthUser } from "@/types";

type Tab = "queue" | "leads" | "follow-ups";

function resolveActiveTab(pathname: string): Tab {
  if (pathname.includes("/follow-ups")) return "follow-ups";
  if (pathname.includes("/leads")) return "leads";
  return "queue";
}

function AgentTabsContainerInner({
  user,
  children,
}: {
  user: AuthUser;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = resolveActiveTab(pathname);

  // follow-ups renders via the dedicated /follow-ups page (FollowUpsPageClient)
  if (active === "follow-ups") {
    return <main id="main-content">{children}</main>;
  }

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
    </main>
  );
}

export const AgentTabsContainer = memo(AgentTabsContainerInner);
