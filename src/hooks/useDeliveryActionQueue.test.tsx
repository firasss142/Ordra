import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import useSWR, { SWRConfig } from "swr";
import { useDeliveryActionQueue, UNDO_WINDOW_MS } from "./useDeliveryActionQueue";
import type { WorklistResponse, WorklistRow } from "@/lib/delivery/types";

const KEY = "/api/delivery/worklist";

const row = (over: Partial<WorklistRow> = {}) =>
  ({
    order_id: "o1", bucket: "act_now", status: "in_transit", reason_codes: ["remark:no_answer"],
    has_open_task: false, next_action_at: null, last_action_at: null, last_action_type: null,
    last_action_outcome: null, last_action_note: null, ...over,
  }) as WorklistRow;

const initial: WorklistResponse = { rows: [row(), row({ order_id: "o2", bucket: "waiting_carrier", reason_codes: [] })], total: 2, generated_at: "x" };

function setup() {
  const cache = new Map();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, fetcher: () => initial }}>{children}</SWRConfig>
  );
  return renderHook(
    () => {
      const list = useSWR<WorklistResponse>(KEY);
      const queue = useDeliveryActionQueue({ worklistKey: KEY });
      return { list, queue };
    },
    { wrapper },
  );
}

const body = { action_type: "call_customer", outcome: "reached_reschedule", note: "jeudi", next_action_at: new Date(Date.now() + 7200e3).toISOString() };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: { id: "a1" } }) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDeliveryActionQueue", () => {
  it("moves the row at once but holds the write for the undo window", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    expect(result.current.list.data?.rows[0].bucket).toBe("act_now");

    act(() => { result.current.queue.queue(initial.rows[0], body); });
    expect(result.current.list.data?.rows[0].bucket).toBe("waiting_customer");
    expect(result.current.queue.pending?.orderId).toBe("o1");
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 10); });
    expect(fetch).toHaveBeenCalledWith(
      "/api/delivery/orders/o1/actions",
      expect.objectContaining({ method: "POST", body: JSON.stringify(body), keepalive: true }),
    );
    expect(result.current.queue.pending).toBeNull();
  });

  it("undo puts the row back and nothing is ever written", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    act(() => { result.current.queue.queue(initial.rows[0], body); });
    act(() => { result.current.queue.undo(); });
    expect(result.current.list.data?.rows[0].bucket).toBe("act_now");
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.queue.pending).toBeNull();
  });

  it("a second action sends the first one straight away instead of dropping it", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    act(() => { result.current.queue.queue(initial.rows[0], body); });
    await act(async () => {
      result.current.queue.queue(initial.rows[1], { action_type: "note", outcome: "none", note: "x", next_action_at: null });
      await vi.advanceTimersByTimeAsync(5);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/delivery/orders/o1/actions");
    expect(result.current.queue.pending?.orderId).toBe("o2");
  });

  it("a refused write restores the row and reports the failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: () => Promise.resolve({ error: "out_of_scope" }) }));
    const onFailed = vi.fn();
    const cache = new Map();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, fetcher: () => initial }}>{children}</SWRConfig>
    );
    const { result } = renderHook(
      () => ({ list: useSWR<WorklistResponse>(KEY), queue: useDeliveryActionQueue({ worklistKey: KEY, onFailed }) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    act(() => { result.current.queue.queue(initial.rows[0], body); });
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 50); });
    expect(onFailed).toHaveBeenCalledWith("out_of_scope");
    expect(result.current.list.data?.rows[0].bucket).toBe("act_now");
  });
});
