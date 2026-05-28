import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import React from "react";
import { useOrderDetailRealtime } from "../useOrderDetailRealtime";

interface ChannelStub {
  name: string;
  filters: Array<{ event: string; filter?: string; table?: string }>;
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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch: ChannelStub = {
        name,
        filters: [],
        handlers: [],
        on(_type, cfg, handler) {
          this.filters.push({ event: cfg.event, filter: cfg.filter, table: cfg.table });
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

beforeEach(() => {
  channels.length = 0;
  removeChannel.mockClear();
});

function fireOn(table: string, eventType: string, payload: { new?: unknown; old?: unknown }) {
  for (const ch of channels) {
    for (let i = 0; i < ch.filters.length; i++) {
      if (ch.filters[i].table === table) {
        ch.handlers[i]({ eventType, ...payload });
      }
    }
  }
}

function makeWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <SWRConfig
        value={{ provider: () => new Map(), dedupingInterval: 0 }}
      >
        {children}
      </SWRConfig>
    );
  };
}

interface OrderEnvelope {
  data: {
    id: string;
    status: string;
    assigned_to?: string | null;
    customer_address?: string | null;
    order_items?: Array<{ id: string; product_name: string }>;
    history?: Array<{ id: string; to_status: string; created_at: string }>;
  };
}

function useTestSetup(
  orderId: string | null,
  initial: OrderEnvelope,
  agentId: string,
  onReassignedAway: ReturnType<typeof vi.fn>,
  onTerminated: ReturnType<typeof vi.fn>,
) {
  const key = orderId ? `/api/orders/${orderId}` : null;
  const swr = useSWR<OrderEnvelope>(key, () => Promise.resolve(initial));
  useOrderDetailRealtime({
    orderId,
    swrKey: key,
    agentId,
    onReassignedAway,
    onTerminated,
  });
  return swr;
}

async function flushSWR() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOrderDetailRealtime", () => {
  test("subscribes to orders, order_items, order_history with id-scoped filter", () => {
    const wrapper = makeWrapper();
    renderHook(
      () =>
        useTestSetup(
          "o1",
          { data: { id: "o1", status: "pending", assigned_to: "agent-1" } },
          "agent-1",
          vi.fn(),
          vi.fn(),
        ),
      { wrapper },
    );

    const tables = channels.flatMap((c) => c.filters.map((f) => f.table));
    expect(tables).toContain("orders");
    expect(tables).toContain("order_items");
    expect(tables).toContain("order_history");
    const filters = channels.flatMap((c) => c.filters.map((f) => f.filter));
    expect(filters.some((f) => f === "id=eq.o1")).toBe(true);
    expect(filters.some((f) => f === "order_id=eq.o1")).toBe(true);
  });

  test("orders UPDATE with reassign-away invokes onReassignedAway and does NOT patch cache", async () => {
    const wrapper = makeWrapper();
    const onReassignedAway = vi.fn();
    const initial: OrderEnvelope = {
      data: { id: "o1", status: "pending", assigned_to: "agent-1", customer_address: "Old" },
    };
    const { result, rerender } = renderHook(
      () => useTestSetup("o1", initial, "agent-1", onReassignedAway, vi.fn()),
      { wrapper },
    );
    await flushSWR();
    rerender();

    await act(async () => {
      fireOn("orders", "UPDATE", {
        old: { id: "o1", status: "pending", assigned_to: "agent-1" },
        new: { id: "o1", status: "pending", assigned_to: "agent-2", customer_address: "New" },
      });
    });
    rerender();

    expect(onReassignedAway).toHaveBeenCalled();
    // Cache should not reflect the new assigned_to/address (panel is closing)
    expect(result.current.data?.data.customer_address).toBe("Old");
  });

  test("orders UPDATE with status=cancelled invokes onTerminated", async () => {
    const wrapper = makeWrapper();
    const onTerminated = vi.fn();
    const initial: OrderEnvelope = {
      data: { id: "o1", status: "pending", assigned_to: "agent-1" },
    };
    renderHook(() => useTestSetup("o1", initial, "agent-1", vi.fn(), onTerminated), { wrapper });
    await flushSWR();

    await act(async () => {
      fireOn("orders", "UPDATE", {
        old: { id: "o1", status: "pending", assigned_to: "agent-1" },
        new: { id: "o1", status: "cancelled", assigned_to: "agent-1" },
      });
    });

    expect(onTerminated).toHaveBeenCalledWith(expect.objectContaining({ kind: "cancelled" }));
  });

  test("orders UPDATE with regular field change patches cache in place", async () => {
    const wrapper = makeWrapper();
    const initial: OrderEnvelope = {
      data: { id: "o1", status: "pending", assigned_to: "agent-1", customer_address: "Old" },
    };
    const { result, rerender } = renderHook(
      () => useTestSetup("o1", initial, "agent-1", vi.fn(), vi.fn()),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireOn("orders", "UPDATE", {
        old: { id: "o1", status: "pending", assigned_to: "agent-1", customer_address: "Old" },
        new: { id: "o1", status: "pending", assigned_to: "agent-1", customer_address: "New" },
      });
      await Promise.resolve();
    });
    rerender();

    expect(result.current.data?.data.customer_address).toBe("New");
  });

  test("order_items INSERT appends to data.order_items", async () => {
    const wrapper = makeWrapper();
    const initial: OrderEnvelope = {
      data: {
        id: "o1",
        status: "pending",
        assigned_to: "agent-1",
        order_items: [{ id: "item-1", product_name: "A" }],
      },
    };
    const { result, rerender } = renderHook(
      () => useTestSetup("o1", initial, "agent-1", vi.fn(), vi.fn()),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireOn("order_items", "INSERT", {
        new: { id: "item-2", product_name: "B" },
      });
      await Promise.resolve();
    });
    rerender();

    expect(result.current.data?.data.order_items?.map((i) => i.id)).toEqual([
      "item-1",
      "item-2",
    ]);
  });

  test("order_history INSERT prepends to data.history", async () => {
    const wrapper = makeWrapper();
    const initial: OrderEnvelope = {
      data: {
        id: "o1",
        status: "pending",
        assigned_to: "agent-1",
        history: [{ id: "h1", to_status: "pending", created_at: "2026-04-14T07:00:00Z" }],
      },
    };
    const { result, rerender } = renderHook(
      () => useTestSetup("o1", initial, "agent-1", vi.fn(), vi.fn()),
      { wrapper },
    );
    await flushSWR();

    await act(async () => {
      fireOn("order_history", "INSERT", {
        new: { id: "h2", to_status: "confirmed", created_at: "2026-04-14T08:00:00Z" },
      });
      await Promise.resolve();
    });
    rerender();

    expect(result.current.data?.data.history?.[0].id).toBe("h2");
  });

  test("does nothing when orderId is null", () => {
    const wrapper = makeWrapper();
    renderHook(
      () =>
        useTestSetup(
          null,
          { data: { id: "x", status: "pending" } },
          "agent-1",
          vi.fn(),
          vi.fn(),
        ),
      { wrapper },
    );
    expect(channels.length).toBe(0);
  });

  test("unsubscribes on unmount", () => {
    const wrapper = makeWrapper();
    const { unmount } = renderHook(
      () =>
        useTestSetup(
          "o1",
          { data: { id: "o1", status: "pending", assigned_to: "agent-1" } },
          "agent-1",
          vi.fn(),
          vi.fn(),
        ),
      { wrapper },
    );
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});
