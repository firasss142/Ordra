import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import React from "react";
import { useAgentQueueRealtime } from "../useAgentQueueRealtime";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import type { AgentQueueCache } from "@/lib/agent-queue/cache-patch";

type BroadcastHandler = (msg: { payload: Record<string, unknown> }) => void;

const channels: Array<{
  name: string;
  opts: unknown;
  handler: BroadcastHandler | null;
}> = [];
const removeChannel = vi.fn();
const setAuth = vi.fn(async () => {});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    realtime: { setAuth },
    channel: (name: string, opts: unknown) => {
      const entry = { name, opts, handler: null as BroadcastHandler | null };
      channels.push(entry);
      const ch = {
        on: (_type: string, _cfg: unknown, handler: BroadcastHandler) => {
          entry.handler = handler;
          return ch;
        },
        subscribe: (cb?: (s: string) => void) => {
          cb?.("SUBSCRIBED");
          return ch;
        },
      };
      return ch;
    },
    removeChannel,
  }),
}));

const MARKET = "00000000-0000-0000-0000-000000000002";

/** Send what the `orders_broadcast_change` trigger actually publishes. */
function fireBroadcast(payload: Record<string, unknown>) {
  channels[0]?.handler?.({ payload });
}

function freshCache(
  rows: Array<Record<string, unknown> & { id: string; status: string }>,
  closed: Array<Record<string, unknown> & { id: string; status: string }> = [],
): AgentQueueCache {
  return {
    orders: rows,
    allOrders: rows,
    closedOrders: closed,
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
      fermees: closed.length,
    },
  };
}

function makeWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <RealtimeProvider>{children}</RealtimeProvider>
      </SWRConfig>
    );
  };
}

function useTestSetup(
  initial: AgentQueueCache,
  agentId: string | null,
  onReassignmentEvent: ReturnType<typeof vi.fn>,
  marketId: string | null = MARKET,
) {
  const swr = useSWR<AgentQueueCache>("/api/agent/queue", () => Promise.resolve(initial));
  const rt = useAgentQueueRealtime({ agentId, marketId, onReassignmentEvent });
  return { swr, rt };
}

async function flushSWR() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const ROW = {
  id: "o1",
  status: "pending",
  assigned_to: "agent-1",
  callback_scheduled_at: null,
  created_at: "2026-04-14T08:00:00Z",
  // Server-derived fields the broadcast payload does NOT carry. They must
  // survive a patch, or the card loses its product name and badges.
  product_display_name: "Livre",
  repeat_kind: "returning",
  last_action_at: "2026-04-14T09:00:00Z",
};

beforeEach(() => {
  channels.length = 0;
  removeChannel.mockClear();
  setAuth.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentQueueRealtime — broadcast transport", () => {
  test("joins the market's PRIVATE broadcast topic, not a postgres_changes channel", async () => {
    const wrapper = makeWrapper();
    renderHook(() => useTestSetup(freshCache([]), "agent-1", vi.fn()), { wrapper });
    await flushSWR();

    // postgres_changes on `orders` is why this queue went stale: Realtime
    // evaluates the table's RLS policy once per changed row per subscriber, and
    // the Darb sync writes ~117k order updates a day. Production logs show that
    // stream stopping 8x and restarting 12x in 24h.
    expect(channels.map((c) => c.name)).toEqual([`orders:market:${MARKET}`]);
    expect((channels[0].opts as { config: { private: boolean } }).config.private).toBe(true);
    expect(setAuth).toHaveBeenCalled();
  });

  test("reports the REAL socket state, not merely that an agent is signed in", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useTestSetup(freshCache([]), "agent-1", vi.fn()),
      { wrapper },
    );
    await flushSWR();

    // `connected` used to be `Boolean(agentId)` — true even with a dead socket,
    // so the page claimed it was live while receiving nothing.
    expect(result.current.rt.connected).toBe(true);
  });

  test("does not subscribe at all without an agent", async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(
      () => useTestSetup(freshCache([]), null, vi.fn()),
      { wrapper },
    );
    await flushSWR();

    expect(channels).toHaveLength(0);
    expect(result.current.rt.connected).toBe(false);
  });

  // THE REPORTED BUG.
  test("a status change moves the card out of its old tab and updates the counts", async () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => useTestSetup(freshCache([{ ...ROW }]), "agent-1", vi.fn()),
      { wrapper },
    );
    await flushSWR();
    expect(result.current.swr.data?.buckets.nouveau).toBe(1);

    await act(async () => {
      fireBroadcast({
        op: "UPDATE",
        id: "o1",
        market_id: MARKET,
        status: "attempt_1",
        assigned_to: "agent-1",
        archived_at: null,
        updated_at: "2026-04-14T10:00:00Z",
      });
      await Promise.resolve();
    });
    rerender();

    const row = result.current.swr.data?.allOrders.find((r) => r.id === "o1");
    expect(row?.status).toBe("attempt_1");
    // The tab counts are what the agent actually reads.
    expect(result.current.swr.data?.buckets.nouveau).toBe(0);
    expect(result.current.swr.data?.buckets.tentative_1).toBe(1);
  });

  test("patching keeps the fields the broadcast does not carry", async () => {
    const wrapper = makeWrapper();
    const { result, rerender } = renderHook(
      () => useTestSetup(freshCache([{ ...ROW }]), "agent-1", vi.fn()),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireBroadcast({
        op: "UPDATE",
        id: "o1",
        market_id: MARKET,
        status: "attempt_1",
        assigned_to: "agent-1",
        archived_at: null,
        updated_at: "2026-04-14T10:00:00Z",
      });
      await Promise.resolve();
    });
    rerender();

    // product_display_name / repeat_kind / last_action_at are computed
    // server-side and have no realtime equivalent. Clobbering them with
    // undefined is how cards used to lose their name and badges.
    const row = result.current.swr.data?.allOrders.find((r) => r.id === "o1");
    expect(row?.product_display_name).toBe("Livre");
    expect(row?.repeat_kind).toBe("returning");
    expect(row?.last_action_at).toBe("2026-04-14T09:00:00Z");
  });

  test("an order reassigned away is removed and reported", async () => {
    const wrapper = makeWrapper();
    const onReassignmentEvent = vi.fn();
    renderHook(
      () => useTestSetup(freshCache([{ ...ROW }]), "agent-1", onReassignmentEvent),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireBroadcast({
        op: "UPDATE",
        id: "o1",
        market_id: MARKET,
        status: "pending",
        assigned_to: "agent-2",
        archived_at: null,
        updated_at: "2026-04-14T10:00:00Z",
      });
      await Promise.resolve();
    });

    expect(onReassignmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", kind: "reassigned" }),
    );
  });

  test("a cancelled order leaves the queue and is reported", async () => {
    const wrapper = makeWrapper();
    const onReassignmentEvent = vi.fn();
    renderHook(
      () => useTestSetup(freshCache([{ ...ROW }]), "agent-1", onReassignmentEvent),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireBroadcast({
        op: "UPDATE",
        id: "o1",
        market_id: MARKET,
        status: "cancelled",
        assigned_to: "agent-1",
        archived_at: null,
        updated_at: "2026-04-14T10:00:00Z",
      });
      await Promise.resolve();
    });

    expect(onReassignmentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "o1", kind: "cancelled" }),
    );
  });

  test("an order for somebody else is ignored", async () => {
    const wrapper = makeWrapper();
    const onReassignmentEvent = vi.fn();
    const { result, rerender } = renderHook(
      () => useTestSetup(freshCache([{ ...ROW }]), "agent-1", onReassignmentEvent),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      // The topic is per MARKET, so an agent receives every order's events.
      // Rows they do not own must be a no-op, not a cache write.
      fireBroadcast({
        op: "UPDATE",
        id: "someone-elses-order",
        market_id: MARKET,
        status: "confirmed",
        assigned_to: "agent-9",
        archived_at: null,
        updated_at: "2026-04-14T10:00:00Z",
      });
      await Promise.resolve();
    });
    rerender();

    expect(result.current.swr.data?.allOrders).toHaveLength(1);
    expect(onReassignmentEvent).not.toHaveBeenCalled();
  });

  test("a new order assigned to this agent triggers a revalidation", async () => {
    vi.useFakeTimers();
    const wrapper = makeWrapper();
    const fetcher = vi.fn(() => Promise.resolve(freshCache([])));
    const { result } = renderHook(
      () => {
        const swr = useSWR<AgentQueueCache>("/api/agent/queue", fetcher);
        const rt = useAgentQueueRealtime({
          agentId: "agent-1",
          marketId: MARKET,
          onReassignmentEvent: vi.fn(),
        });
        return { swr, rt };
      },
      { wrapper },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const before = fetcher.mock.calls.length;

    act(() => {
      // An INSERT carries no enriched row, so the only correct response is to
      // ask the server — once per burst, not once per event.
      for (let i = 0; i < 4; i++) {
        fireBroadcast({
          op: "INSERT",
          id: `n${i}`,
          market_id: MARKET,
          status: "pending",
          assigned_to: "agent-1",
          archived_at: null,
          updated_at: "x",
        });
      }
    });
    act(() => { vi.advanceTimersByTime(400); });
    await act(async () => { await Promise.resolve(); });

    expect(fetcher.mock.calls.length).toBe(before + 1);
    expect(result.current.rt.connected).toBe(true);
  });
});
