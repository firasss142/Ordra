import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { AgentTabsContainer } from "@/components/layout/AgentTabsContainer";
import type { AuthUser } from "@/types";

/**
 * The agent shell keeps both tabs mounted so switching is instant. The cost of
 * doing that eagerly was that EVERY agent entry point paid for BOTH tabs:
 * opening /ar/leads still mounted QueuePage, which on mount fires
 * /api/agent/queue, /api/agent/stats, /api/products/search, /api/cities and a
 * market-wide Darb carrier sweep (~550ms) — none of which the leads list needs.
 *
 * Mounting is therefore latched on first visit: a tab mounts when the agent
 * first opens it and stays mounted afterwards. These tests pin both halves of
 * that contract — the tab you opened renders, the one you never opened is not
 * mounted at all, and once visited it survives a switch away.
 */

let pathnameMock = "/ar/queue";
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock,
}));

const queueMounted = vi.fn();
const leadsMounted = vi.fn();

// Counts MOUNTS, not renders: the point of the latch is that a tab is
// constructed (and fires its fetch waterfall) at most once.
vi.mock("@/components/queue/QueuePage", () => ({
  QueuePage: () => {
    useEffect(() => { queueMounted(); }, []);
    return <div data-testid="queue-tab">queue</div>;
  },
}));

vi.mock("@/components/crm/AgentLeadsQueue", () => ({
  AgentLeadsQueue: () => {
    useEffect(() => { leadsMounted(); }, []);
    return <div data-testid="leads-tab">leads</div>;
  },
}));

const user = {
  id: "u1",
  email: "a@b.c",
  full_name: "tasnim",
  avatar_url: null,
  role: "agent",
  market_id: "m1",
  locale: "ar",
  direction: "rtl",
} as unknown as AuthUser;

describe("AgentTabsContainer — tabs mount on first visit, not up-front", () => {
  beforeEach(() => {
    queueMounted.mockClear();
    leadsMounted.mockClear();
  });
  afterEach(cleanup);

  it("does not mount the orders queue when the agent opens the leads tab", () => {
    pathnameMock = "/ar/leads";
    render(<AgentTabsContainer user={user} />);

    expect(screen.getByTestId("leads-tab")).toBeInTheDocument();
    // The regression: QueuePage used to mount here and fire the whole orders
    // fetch waterfall (plus the Darb sweep) before leads could render.
    expect(queueMounted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("queue-tab")).not.toBeInTheDocument();
  });

  it("does not mount the leads tab when the agent opens the queue", () => {
    pathnameMock = "/ar/queue";
    render(<AgentTabsContainer user={user} />);

    expect(screen.getByTestId("queue-tab")).toBeInTheDocument();
    expect(leadsMounted).not.toHaveBeenCalled();
  });

  it("keeps a visited tab mounted after switching away, so switching stays instant", () => {
    pathnameMock = "/ar/queue";
    const { rerender } = render(<AgentTabsContainer user={user} />);
    expect(queueMounted).toHaveBeenCalledTimes(1);

    pathnameMock = "/ar/leads";
    // AgentTabsContainer is memo()-wrapped, so a rerender with the identical
    // `user` object is skipped entirely. In the app the navigation that changes
    // usePathname() also re-renders the shell, so pass a fresh object to model
    // that — otherwise this asserts memo's behaviour, not the mount latch.
    rerender(<AgentTabsContainer user={{ ...user }} />);

    // Both are now in the DOM (queue hidden, not unmounted) and the queue was
    // never re-mounted — that is what makes the second switch free.
    expect(screen.getByTestId("leads-tab")).toBeInTheDocument();
    expect(screen.getByTestId("queue-tab")).toBeInTheDocument();
    expect(queueMounted).toHaveBeenCalledTimes(1);
  });

  it("renders neither tab on follow-ups, which has its own page", () => {
    pathnameMock = "/ar/follow-ups";
    render(<AgentTabsContainer user={user}><div data-testid="child" /></AgentTabsContainer>);

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(queueMounted).not.toHaveBeenCalled();
    expect(leadsMounted).not.toHaveBeenCalled();
  });
});
