import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import React from "react";
import { useAgentQueueRealtime } from "../useAgentQueueRealtime";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import type { AgentQueueCache } from "@/lib/agent-queue/cache-patch";

interface ChannelStub {
  filters: Array<{ event: string; filter?: string }>;
  handlers: Array<(payload: unknown) => void>;
  on: (
    type: string,
    cfg: { event: string; filter?: string; schema?: string; table?: string },
    handler: (payload: unknown) => void,
  ) => ChannelStub;
  subscribe: (cb?: (state: string) => void) => ChannelStub;
  unsubscribe: () => void;
}

const channels: ChannelStub[] = [];
const removeChannel = vi.fn();
let lastChannelName = "";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      lastChannelName = name;
      const ch: ChannelStub = {
        filters: [],
        handlers: [],
        on(_type, cfg, handler) {
          this.filters.push({ event: cfg.event, filter: cfg.filter });
          this.handlers.push(handler);
          return this;
        },
        subscribe(cb) {
          if (cb) cb("SUBSCRIBED");
          return this;
        },
        unsubscribe() {},
      };
      channels.push(ch);
      return ch;
    },
    removeChannel,
  }),
}));

function fireOnChannel(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  payload: { new?: unknown; old?: unknown },
) {
  const ch = channels[0];
  ch.handlers[0]({ eventType, ...payload });
}

function freshCache(rows: Array<Record<string, unknown> & { id: string; status: string }>): AgentQueueCache {
  return {
    orders: rows,
    allOrders: rows,
    closedOrders: [],
    buckets: {
      nouveau: rows.length,
      tentative_1: 0,
      tentative_2: 0,
      tentative_3: 0,
      tentative_total: 0,
      rappel_prevu: 0,
      livraison_planifiee: 0,
      confirme: 0,
      rejete: 0,
      fermees: 0,
    },
  };
}

function makeWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => new Map(),
          dedupingInterval: 0,
        }}
      >
        <RealtimeProvider>{children}</RealtimeProvider>
      </SWRConfig>
    );
  };
}

function useTestSetup(
  initial: AgentQueueCache,
  agentId: string | null,
  onReassignmentEvent: ReturnType<typeof vi.fn>,
  marketId: string | null = "market-tn",
) {
  const swr = useSWR<AgentQueueCache>(
    "/api/agent/queue",
    () => Promise.resolve(initial),
  );
  useAgentQueueRealtime({ agentId, marketId, onReassignmentEvent });
  return swr;
}

async function flushSWR() {
  // Let the SWR fetcher promise resolve and the cache write
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  channels.length = 0;
  removeChannel.mockClear();
  lastChannelName = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentQueueRealtime", () => {
  test("subscribes with a single agent-queue channel filtered by market_id", () => {
    const wrapper = makeWrapper();
    renderHook(() => useTestSetup(freshCache([]), "agent-1", vi.fn(), "market-tn"), {
      wrapper,
    });

    expect(channels).toHaveLength(1);
    const filters = channels.flatMap((c) => c.filters);
    expect(filters.some((f) => f.filter === "market_id=eq.market-tn")).toBe(true);
  });

  test("INSERT event updates SWR cache with new row", async () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => useTestSetup(freshCache([]), "agent-1", vi.fn()),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireOnChannel("INSERT", {
        new: {
          id: "o-new",
          status: "pending",
          assigned_to: "agent-1",
          callback_scheduled_at: null,
          created_at: "2026-04-14T08:00:00Z",
        },
      });
      await Promise.resolve();
    });
    rerender();

    expect(result.current.data?.allOrders.some((r) => r.id === "o-new")).toBe(true);
  });

  test("UPDATE reassigning away invokes onReassignmentEvent", async () => {
    const wrapper = makeWrapper();
    const onReassignmentEvent = vi.fn();
    const initial = freshCache([
      {
        id: "o1",
        status: "pending",
        assigned_to: "agent-1",
        callback_scheduled_at: null,
        created_at: "2026-04-14T08:00:00Z",
      },
    ]);

    renderHook(() => useTestSetup(initial, "agent-1", onReassignmentEvent), { wrapper });
    await flushSWR();

    await act(async () => {
      fireOnChannel("UPDATE", {
        old: { id: "o1", status: "pending", assigned_to: "agent-1" },
        new: {
          id: "o1",
          status: "pending",
          assigned_to: "agent-2",
          callback_scheduled_at: null,
          created_at: "2026-04-14T08:00:00Z",
        },
      });
    });

    expect(onReassignmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", kind: "reassigned" }),
    );
  });

  test("UPDATE status→cancelled invokes onReassignmentEvent with kind=cancelled", async () => {
    const wrapper = makeWrapper();
    const onReassignmentEvent = vi.fn();
    const initial = freshCache([
      {
        id: "o1",
        status: "pending",
        assigned_to: "agent-1",
        callback_scheduled_at: null,
        created_at: "2026-04-14T08:00:00Z",
      },
    ]);

    renderHook(() => useTestSetup(initial, "agent-1", onReassignmentEvent), { wrapper });
    await flushSWR();

    await act(async () => {
      fireOnChannel("UPDATE", {
        old: { id: "o1", status: "pending", assigned_to: "agent-1" },
        new: {
          id: "o1",
          status: "cancelled",
          assigned_to: "agent-1",
          callback_scheduled_at: null,
          created_at: "2026-04-14T08:00:00Z",
        },
      });
    });

    expect(onReassignmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", kind: "cancelled" }),
    );
  });

  test("unsubscribes on unmount", () => {
    const wrapper = makeWrapper();
    const { unmount } = renderHook(() => useTestSetup(freshCache([]), "agent-1", vi.fn()), {
      wrapper,
    });
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });

  test("returns connected state via the hook", () => {
    const wrapper = makeWrapper();
    function probe() {
      const swr = useSWR<AgentQueueCache>("/api/agent/queue", () => Promise.resolve(freshCache([])), {
        fallbackData: freshCache([]),
      });
      const rt = useAgentQueueRealtime({ agentId: "agent-1", onReassignmentEvent: vi.fn() });
      return { swr, rt };
    }
    const { result } = renderHook(probe, { wrapper });
    expect(result.current.rt).toHaveProperty("connected");
  });

  test("does nothing when agentId is null", () => {
    const wrapper = makeWrapper();
    renderHook(() => useTestSetup(freshCache([]), null, vi.fn()), { wrapper });
    expect(channels.length).toBe(0);
  });
});
