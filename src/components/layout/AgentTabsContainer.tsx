"use client";

import { memo, useRef } from "react";
import { usePathname } from "next/navigation";
import { QueuePage } from "@/components/queue/QueuePage";
import { AgentLeadsQueue } from "@/components/crm/AgentLeadsQueue";
import type { AuthUser } from "@/types";

type Tab = "queue" | "leads" | "follow-ups" | "commissions";

function resolveActiveTab(pathname: string): Tab {
  if (pathname.includes("/follow-ups")) return "follow-ups";
  if (pathname.includes("/commissions")) return "commissions";
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

  // Both tabs stay mounted so switching between them is instant — but only
  // AFTER the agent has actually visited them. Mounting both up-front made
  // every agent entry point pay for both: opening /leads still mounted
  // QueuePage, which fires /api/agent/queue, /api/agent/stats,
  // /api/products/search, /api/cities and the market-wide Darb carrier sweep
  // (~550ms) before the leads list could render.
  //
  // The ref accumulates the tabs seen so far; `active` is unioned in on the way
  // out rather than written back during render. Reading a ref while rendering
  // is safe (it is only ever added to, never removed from, so the render stays
  // consistent), and it avoids both a render-phase setState — which re-runs
  // this component and would mount the newly-visited tab twice — and an effect,
  // which would paint one frame before the tab appeared.
  const visitedRef = useRef<Set<Tab>>(new Set());
  visitedRef.current.add(active);
  const visited = visitedRef.current;

  // follow-ups and commissions render via their own pages
  if (active === "follow-ups" || active === "commissions") {
    return <main id="main-content">{children}</main>;
  }

  return (
    <main id="main-content">
      {visited.has("queue") && (
        <div
          style={{ display: active === "queue" ? "block" : "none" }}
          aria-hidden={active !== "queue"}
        >
          <QueuePage />
        </div>
      )}
      {visited.has("leads") && (
        <div
          style={{ display: active === "leads" ? "block" : "none" }}
          aria-hidden={active !== "leads"}
        >
          <AgentLeadsQueue user={user} />
        </div>
      )}
    </main>
  );
}

export const AgentTabsContainer = memo(AgentTabsContainerInner);
