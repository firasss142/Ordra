"use client";

import { memo, useRef } from "react";
import { usePathname } from "next/navigation";
import { AgentQueuePage as QueuePage } from "@/components/agent/queue/AgentQueuePage";
import type { AuthUser } from "@/types";

type Tab = "queue" | "leads" | "delivery" | "commissions" | "feedback";

function resolveActiveTab(pathname: string): Tab {
  if (pathname.includes("/delivery")) return "delivery";
  if (pathname.includes("/commissions")) return "commissions";
  if (pathname.includes("/feedback")) return "feedback";
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

  // delivery, commissions and « Voix du client » render via their own pages
  if (active === "delivery" || active === "commissions" || active === "feedback") {
    return (
      <main id="main-content" className="agt-main">
        <div className="page">{children}</div>
      </main>
    );
  }

  return (
    <main id="main-content" className="agt-main">
      {visited.has("queue") && (
        <div
          className="page"
          style={active === "queue" ? undefined : { display: "none" }}
          aria-hidden={active !== "queue"}
        >
          <QueuePage />
        </div>
      )}
      {/*
        The leads tab renders the route's own page — « Prospects »,
        src/components/prospects — rather than a component chosen here. The
        shell used to import AgentLeadsQueue directly and drop `children`, so
        whatever /leads returned never reached the screen.

        It is not kept mounted behind the queue the way QueuePage is: `children`
        belongs to the current route, and Next.js has already replaced it by the
        time the agent is back on /queue. Hiding it would leave the previous
        route's markup on the page.
      */}
      {active === "leads" && <div className="page">{children}</div>}
    </main>
  );
}

export const AgentTabsContainer = memo(AgentTabsContainerInner);
