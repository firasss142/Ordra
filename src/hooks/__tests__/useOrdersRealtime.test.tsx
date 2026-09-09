import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

type BroadcastHandler = (msg: { payload: Record<string, unknown> }) => void;

const channels: Array<{
  name: string;
  opts: unknown;
  handler: BroadcastHandler | null;
  statusCb: ((s: string) => void) | null;
}> = [];
const removeChannel = vi.fn();
const setAuth = vi.fn(async () => {});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    realtime: { setAuth },
    channel: (name: string, opts: unknown) => {
      const entry = { name, opts, handler: null as BroadcastHandler | null, statusCb: null as ((s: string) => void) | null };
      channels.push(entry);
      const ch = {
        on: (_type: string, _cfg: unknown, handler: BroadcastHandler) => {
          entry.handler = handler;
          return ch;
        },
        subscribe: (cb?: (s: string) => void) => {
          entry.statusCb = cb ?? null;
          cb?.("SUBSCRIBED");
          return ch;
        },
      };
      return ch;
    },
    removeChannel,
  }),
}));

const toast = vi.fn();
vi.mock("@/lib/realtime/toast", () => ({ useRealtimeToast: () => toast }));

import { RealtimeProvider } from "@/components/providers/RealtimeProvider";
import { useOrdersRealtime } from "@/hooks/useOrdersRealtime";
import type { OrdersListPage, OrdersListRow } from "@/hooks/useOrdersList";

const MARKET = "00000000-0000-0000-0000-000000000002";

function row(over: Partial<OrdersListRow>): OrdersListRow {
  return {
    id: "o1",
    external_id: "EXT-1",
    external_platform: null,
    market_id: MARKET,
    customer_name: "Salima",
    customer_phone: null,
    customer_address: null,
    customer_city: null,
    product_id: null,
    product_name: "Livre",
    product_display_name: "Livre",
    product_image_url: "https://img/x.png",
    variant_label: null,
    quantity: 1,
    total_price: 10,
    status: "pending",
    assigned_to: null,
    carrier_id: null,
    rejection_reason: null,
    carrier_barcode_deleted_at: null,
    carrier_barcode_deleted_carrier_code: null,
    callback_scheduled_at: null,
    attempts_count: 0,
    created_at: "2026-09-09T00:00:00Z",
    updated_at: "2026-09-09T00:00:00Z",
    terminal_at: null,
    archived_at: null,
    archived_by: null,
    repeat_kind: "returning",
    ...over,
  } as OrdersListRow;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RealtimeProvider>{children}</RealtimeProvider>
    </SWRConfig>
  );
}

/** A mutate double that applies functional updates to a held page set. */
function makeMutate(initial: OrdersListPage[]) {
  let pages = initial;
  const mutate = vi.fn((updater?: unknown, _opts?: unknown) => {
    if (typeof updater === "function") pages = (updater as (p: OrdersListPage[]) => OrdersListPage[])(pages);
    return Promise.resolve(pages);
  });
  return { mutate, pages: () => pages };
}

async function flushJoin() {
  // openBroadcast awaits setAuth before creating the channel.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useOrdersRealtime (broadcast)", () => {
  beforeEach(() => {
    channels.length = 0;
    removeChannel.mockClear();
    toast.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins one private topic per market and reports connected", async () => {
    const { mutate } = makeMutate([{ rows: [], nextCursor: null }]);
    const { result } = renderHook(
      () => useOrdersRealtime({ marketIds: [MARKET], mutate: mutate as never, matchFilter: () => true }),
      { wrapper },
    );
    await flushJoin();

    expect(channels.map((c) => c.name)).toEqual([`orders:market:${MARKET}`]);
    expect((channels[0].opts as { config: { private: boolean } }).config.private).toBe(true);
    expect(setAuth).toHaveBeenCalled();
    expect(result.current.connected).toBe(true);
  });

  it("patches only status/assignee/archive fields in place and keeps the enriched rest", async () => {
    const { mutate, pages } = makeMutate([{ rows: [row({})], nextCursor: null }]);
    renderHook(
      () => useOrdersRealtime({ marketIds: [MARKET], mutate: mutate as never, matchFilter: () => true }),
      { wrapper },
    );
    await flushJoin();
    mutate.mockClear();

    act(() => {
      channels[0].handler?.({
        payload: { op: "UPDATE", id: "o1", market_id: MARKET, status: "confirmed", assigned_to: "agent-1", archived_at: null, updated_at: "2026-09-09T01:00:00Z" },
      });
    });

    const patched = pages()[0].rows[0];
    expect(patched.status).toBe("confirmed");
    expect(patched.assigned_to).toBe("agent-1");
    expect(patched.product_image_url).toBe("https://img/x.png");
    expect(patched.repeat_kind).toBe("returning");
  });

  it("coalesces a burst into one revalidation of the list", async () => {
    const { mutate } = makeMutate([{ rows: [], nextCursor: null }]);
    renderHook(
      () => useOrdersRealtime({ marketIds: [MARKET], mutate: mutate as never, matchFilter: () => true }),
      { wrapper },
    );
    await flushJoin();
    mutate.mockClear();

    act(() => {
      for (let i = 0; i < 5; i++) {
        channels[0].handler?.({
          payload: { op: "INSERT", id: `n${i}`, market_id: MARKET, status: "pending", assigned_to: null, archived_at: null, updated_at: "x" },
        });
      }
    });
    expect(mutate.mock.calls.filter((c) => c.length === 0)).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    // Exactly one bare mutate() — the revalidation — for five events.
    expect(mutate.mock.calls.filter((c) => c.length === 0)).toHaveLength(1);
  });

  it("removes a row that no longer matches and toasts a terminal transition", async () => {
    const { mutate, pages } = makeMutate([{ rows: [row({})], nextCursor: null }]);
    renderHook(
      () =>
        useOrdersRealtime({
          marketIds: [MARKET],
          mutate: mutate as never,
          matchFilter: (r) => r.status === "pending",
        }),
      { wrapper },
    );
    await flushJoin();

    act(() => {
      channels[0].handler?.({
        payload: { op: "UPDATE", id: "o1", market_id: MARKET, status: "rejected", assigned_to: null, archived_at: null, updated_at: "y" },
      });
    });

    expect(pages()[0].rows).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ external_id: "EXT-1" }), "rejected");
  });
});
