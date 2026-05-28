import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";
import React from "react";
import { useOptimisticOrderAction } from "../useOptimisticOrderAction";
import type { AgentQueueCache } from "@/lib/agent-queue/cache-patch";

function freshCacheWith(rows: Array<{ id: string; status: string; assigned_to: string }>): AgentQueueCache {
  return {
    orders: rows,
    allOrders: rows,
    closedOrders: [],
    buckets: {
      nouveau: rows.filter((r) => r.status === "pending").length,
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
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    );
  };
}

function useSetup(orderId: string, initial: AgentQueueCache) {
  const queue = useSWR<AgentQueueCache>("/api/agent/queue", () => Promise.resolve(initial));
  const { run } = useOptimisticOrderAction(orderId);
  return { queue, run };
}

async function flushSWR() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOptimisticOrderAction", () => {
  test("optimistically patches the queue cache before the request resolves", async () => {
    const wrapper = makeWrapper();
    const initial = freshCacheWith([{ id: "o1", status: "pending", assigned_to: "a1" }]);
    const { result, rerender } = renderHook(() => useSetup("o1", initial), { wrapper });
    await flushSWR();
    rerender();

    // Slow-resolving request
    let resolveRequest: (v: { ok: boolean; status: number }) => void = () => {};
    const requestPromise = new Promise<{ ok: boolean; status: number }>((res) => {
      resolveRequest = res;
    });

    let runResult: { ok: boolean } | undefined;
    act(() => {
      result.current.run({
        optimisticPatch: () => ({ status: "confirmed" }),
        request: () => requestPromise as unknown as Promise<Response>,
      }).then((r) => {
        runResult = r;
      });
    });

    // Allow optimistic patch to apply
    await act(async () => {
      await Promise.resolve();
    });
    rerender();

    expect(result.current.queue.data?.allOrders.find((r) => r.id === "o1")?.status).toBe("confirmed");
    expect(result.current.queue.data?.buckets.confirme).toBe(1);
    expect(result.current.queue.data?.buckets.nouveau).toBe(0);

    // Now resolve the request successfully
    await act(async () => {
      resolveRequest({ ok: true, status: 200 });
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    expect(runResult?.ok).toBe(true);
    // Status remains confirmed after success
    expect(result.current.queue.data?.allOrders.find((r) => r.id === "o1")?.status).toBe("confirmed");
  });

  test("rolls back on request error", async () => {
    const wrapper = makeWrapper();
    const initial = freshCacheWith([{ id: "o1", status: "pending", assigned_to: "a1" }]);
    const { result, rerender } = renderHook(() => useSetup("o1", initial), { wrapper });
    await flushSWR();
    rerender();

    await act(async () => {
      await result.current.run({
        optimisticPatch: () => ({ status: "confirmed" }),
        request: async () => {
          throw new Error("network failed");
        },
      });
    });
    rerender();

    expect(result.current.queue.data?.allOrders.find((r) => r.id === "o1")?.status).toBe("pending");
    expect(result.current.queue.data?.buckets.nouveau).toBe(1);
    expect(result.current.queue.data?.buckets.confirme).toBe(0);
  });

  test("rolls back on !response.ok", async () => {
    const wrapper = makeWrapper();
    const initial = freshCacheWith([{ id: "o1", status: "pending", assigned_to: "a1" }]);
    const { result, rerender } = renderHook(() => useSetup("o1", initial), { wrapper });
    await flushSWR();
    rerender();

    let runResult: { ok: boolean; status?: number } | undefined;
    await act(async () => {
      runResult = await result.current.run({
        optimisticPatch: () => ({ status: "confirmed" }),
        request: async () => ({ ok: false, status: 409 } as unknown as Response),
      });
    });
    rerender();

    expect(runResult?.ok).toBe(false);
    expect(runResult?.status).toBe(409);
    expect(result.current.queue.data?.allOrders.find((r) => r.id === "o1")?.status).toBe("pending");
  });
});
