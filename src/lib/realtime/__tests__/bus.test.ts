import { describe, test, expect, vi, beforeEach } from "vitest";

interface ChannelStub {
  name: string;
  filters: Array<{ event: string; filter?: string; table?: string }>;
  handlers: Array<(payload: unknown) => void>;
  removed: boolean;
  on: (
    type: string,
    cfg: { event: string; filter?: string; schema?: string; table?: string },
    handler: (payload: unknown) => void,
  ) => ChannelStub;
  subscribe: (cb?: (state: string) => void) => ChannelStub;
  unsubscribe: () => void;
}

const channels: ChannelStub[] = [];
const removeChannel = vi.fn((ch: ChannelStub) => {
  ch.removed = true;
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch: ChannelStub = {
        name,
        filters: [],
        handlers: [],
        removed: false,
        on(_type, cfg, handler) {
          this.filters.push({ event: cfg.event, filter: cfg.filter, table: cfg.table });
          this.handlers.push(handler);
          return this;
        },
        subscribe(cb) {
          if (cb) cb("SUBSCRIBED");
          return this;
        },
        unsubscribe() {
          this.removed = true;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel,
  }),
}));

import { createRealtimeBus } from "@/lib/realtime/bus";

function fire(ch: ChannelStub, eventType: string, payload: { new?: unknown; old?: unknown }) {
  ch.handlers[0]({ eventType, ...payload });
}

beforeEach(() => {
  channels.length = 0;
  removeChannel.mockClear();
});

describe("realtime bus", () => {
  test("opens exactly one channel per (marketId, table) regardless of subscriber count", () => {
    const bus = createRealtimeBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();

    bus.subscribe({ table: "orders", marketId: "market-tn" }, h1);
    bus.subscribe({ table: "orders", marketId: "market-tn" }, h2);
    bus.subscribe({ table: "orders", marketId: "market-tn" }, h3);

    expect(channels).toHaveLength(1);
    expect(channels[0].filters[0].filter).toBe("market_id=eq.market-tn");
  });

  test("opens separate channels for different tables", () => {
    const bus = createRealtimeBus();
    bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    bus.subscribe({ table: "order_items", marketId: "market-tn" }, vi.fn());
    expect(channels).toHaveLength(2);
  });

  test("opens separate channels for different markets on the same table", () => {
    const bus = createRealtimeBus();
    bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    bus.subscribe({ table: "orders", marketId: "market-ly" }, vi.fn());
    expect(channels).toHaveLength(2);
  });

  test("super_admin (marketId=null) gets an unfiltered channel", () => {
    const bus = createRealtimeBus();
    bus.subscribe({ table: "orders", marketId: null }, vi.fn());
    expect(channels).toHaveLength(1);
    expect(channels[0].filters[0].filter).toBeUndefined();
  });

  test("fans an event out to every active subscriber on the channel", () => {
    const bus = createRealtimeBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe({ table: "orders", marketId: "market-tn" }, h1);
    bus.subscribe({ table: "orders", marketId: "market-tn" }, h2);

    fire(channels[0], "INSERT", { new: { id: "o-1", status: "pending" } });

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h1.mock.calls[0][0]).toEqual({
      eventType: "INSERT",
      new: { id: "o-1", status: "pending" },
    });
  });

  test("unsubscribing one of many handlers does not close the channel", () => {
    const bus = createRealtimeBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = bus.subscribe({ table: "orders", marketId: "market-tn" }, h1);
    bus.subscribe({ table: "orders", marketId: "market-tn" }, h2);

    unsub1();

    expect(channels[0].removed).toBe(false);
    fire(channels[0], "INSERT", { new: { id: "o-1" } });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledTimes(1);
  });

  test("closes the channel only after the last subscriber unsubscribes", () => {
    const bus = createRealtimeBus();
    const unsub1 = bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    const unsub2 = bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());

    unsub1();
    expect(removeChannel).not.toHaveBeenCalled();
    unsub2();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  test("re-subscribing to a previously-closed (marketId, table) opens a fresh channel", () => {
    const bus = createRealtimeBus();
    const unsub1 = bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    unsub1();
    expect(channels).toHaveLength(1);

    bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    expect(channels).toHaveLength(2);
  });

  test("respects an optional extra filter (e.g. assigned_to) by opening a separate channel", () => {
    const bus = createRealtimeBus();
    bus.subscribe({ table: "orders", marketId: "market-tn" }, vi.fn());
    bus.subscribe(
      { table: "orders", marketId: "market-tn", extraFilter: "assigned_to=eq.agent-1" },
      vi.fn(),
    );

    expect(channels).toHaveLength(2);
    const filters = channels.flatMap((c) => c.filters.map((f) => f.filter));
    expect(filters).toContain("market_id=eq.market-tn");
    expect(filters.some((f) => f?.includes("assigned_to=eq.agent-1"))).toBe(true);
  });
});
