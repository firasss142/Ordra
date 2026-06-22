import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useOrderDetailRealtime } from "./useOrderDetailRealtime";

const ORDER_ID = "order-abc";
const KEY = `/api/orders/${ORDER_ID}`;

// Captured realtime handlers keyed by table.
const handlers: Record<string, (payload: unknown) => void> = {};
// Captured onUnlock listeners.
const unlockListeners: Array<(k: { table: string; rowId: string }) => void> = [];
let locked = false;

const mutateMock = vi.fn();

vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

vi.mock("@/components/providers/RealtimeProvider", () => ({
  useRealtimeSubscribe: (
    opts: { table: string } | null,
    handler: (payload: unknown) => void,
  ) => {
    if (opts) handlers[opts.table] = handler;
  },
  useRealtime: () => ({
    editLock: {
      isLocked: () => locked,
      lock: () => {
        locked = true;
      },
      unlock: () => {
        locked = false;
        for (const l of unlockListeners) l({ table: "orders", rowId: ORDER_ID });
      },
      onUnlock: (cb: (k: { table: string; rowId: string }) => void) => {
        unlockListeners.push(cb);
        return () => {
          const i = unlockListeners.indexOf(cb);
          if (i >= 0) unlockListeners.splice(i, 1);
        };
      },
    },
  }),
}));

function renderHookForOrder() {
  return renderHook(() =>
    useOrderDetailRealtime({
      orderId: ORDER_ID,
      swrKey: KEY,
      agentId: "agent-1",
      onReassignedAway: () => {},
      onTerminated: () => {},
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  mutateMock.mockClear();
  for (const k of Object.keys(handlers)) delete handlers[k];
  unlockListeners.length = 0;
  locked = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOrderDetailRealtime — itemsHandler edit-lock guard", () => {
  it("patches order_items in cache immediately on UPDATE when unlocked", () => {
    renderHookForOrder();
    handlers.order_items({
      eventType: "UPDATE",
      new: { id: "item-1", unit_price: 99 },
    });
    // In-place patch (revalidate:false) fires synchronously.
    expect(mutateMock).toHaveBeenCalledWith(
      KEY,
      expect.any(Function),
      expect.objectContaining({ revalidate: false }),
    );
  });

  it("does NOT schedule a blind revalidation while the order is edit-locked", () => {
    renderHookForOrder();
    locked = true;
    handlers.order_items({
      eventType: "UPDATE",
      new: { id: "item-1", unit_price: 99 },
    });
    mutateMock.mockClear();
    vi.advanceTimersByTime(600);
    // No blind mutate(KEY) full revalidation while locked.
    const blindCall = mutateMock.mock.calls.find(
      (c) => c[0] === KEY && c.length === 1,
    );
    expect(blindCall).toBeUndefined();
  });

  it("schedules a blind revalidation after 500ms when unlocked", () => {
    renderHookForOrder();
    handlers.order_items({
      eventType: "UPDATE",
      new: { id: "item-1", unit_price: 99 },
    });
    mutateMock.mockClear();
    vi.advanceTimersByTime(600);
    const blindCall = mutateMock.mock.calls.find(
      (c) => c[0] === KEY && c.length === 1,
    );
    expect(blindCall).toBeDefined();
  });

  it("flushes a queued items revalidation once on unlock", () => {
    renderHookForOrder();
    locked = true;
    handlers.order_items({
      eventType: "UPDATE",
      new: { id: "item-1", unit_price: 99 },
    });
    mutateMock.mockClear();
    // Unlock triggers the queued flush.
    unlockListeners.forEach((l) => l({ table: "orders", rowId: ORDER_ID }));
    locked = false;
    const blindCalls = mutateMock.mock.calls.filter(
      (c) => c[0] === KEY && c.length === 1,
    );
    expect(blindCalls.length).toBe(1);
  });
});
