import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import React from "react";
import { SWRConfig } from "swr";

interface ChannelStub {
  name: string;
  opts: unknown;
  handler?: (p: unknown) => void;
  on: (t: string, cfg: unknown, h: (p: unknown) => void) => ChannelStub;
  subscribe: (cb?: (s: string) => void) => ChannelStub;
  unsubscribe: () => void;
}
const channels: ChannelStub[] = [];

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    realtime: { setAuth: vi.fn() },
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
    channel: (name: string, opts: unknown) => {
      const ch: ChannelStub = {
        name,
        opts,
        on(_t, _cfg, h) { this.handler = h; return this; },
        subscribe(cb) { cb?.("SUBSCRIBED"); return this; },
        unsubscribe() {},
      };
      channels.push(ch);
      return ch;
    },
    removeChannel: vi.fn(),
  }),
}));

import { useOrderLocks } from "../useOrderLocks";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";

const NOW = new Date("2026-09-10T10:00:00.000Z");
const soon = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();

const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RealtimeProvider>{children}</RealtimeProvider>
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  channels.length = 0;
  fetchMock.mockReset().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: [
            { order_id: "o-1", user_id: "a-1", role: "agent", mode: "editing",
              opened_at: NOW.toISOString(), expires_at: soon(75) },
          ],
          server_now: NOW.toISOString(),
        }),
    } as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = () => renderHook(() => useOrderLocks({ marketId: "m-1", enabled: true }), { wrapper });

describe("useOrderLocks", () => {
  test("reports an order as locked while its row is live", async () => {
    const { result } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.lockOf("o-1")?.user_id).toBe("a-1");
  });

  // Expiry produces no DB event, so only a local tick can retire a stale row.
  test("drops the lock once expires_at passes, with no new data", async () => {
    const { result } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(result.current.lockOf("o-1")).not.toBeNull();

    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve({ data: [], server_now: soon(80) }) } as Response));

    await act(async () => { await vi.advanceTimersByTimeAsync(80_000); });
    expect(result.current.lockOf("o-1")).toBeNull();
  });

  test("subscribes to the market presence topic, never the orders topic", async () => {
    render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const names = channels.map((c) => c.name);
    expect(names.some((n) => n.includes("order_presence:market:m-1"))).toBe(true);
    expect(names.some((n) => n.startsWith("bus:orders:market:"))).toBe(false);
  });

  test("does nothing when disabled", async () => {
    renderHook(() => useOrderLocks({ marketId: "m-1", enabled: false }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useOrderLocks — render stability", () => {
  test("returns the same array identity for an order with nobody on it", async () => {
    const { result } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    // A fresh [] per call would defeat OrderRow's memo for every unlocked row.
    expect(result.current.presenceOf("other")).toBe(result.current.presenceOf("another"));
  });

  test("keeps the same array identity across a heartbeat that only moves expires_at", async () => {
    const { result } = render();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const before = result.current.presenceOf("o-1");

    await act(async () => {
      channels.find((c) => c.name.includes("order_presence"))?.handler?.({
        payload: { op: "UPDATE", order_id: "o-1", user_id: "a-1", role: "agent",
                   mode: "editing", opened_at: NOW.toISOString(), expires_at: soon(140) },
      });
      await Promise.resolve();
    });

    expect(result.current.presenceOf("o-1")).toBe(before);
  });
});

describe("useOrderLocks — agent scope", () => {
  test("an agent subscribes to their OWN topic, never the market-wide one", async () => {
    renderHook(
      () => useOrderLocks({ marketId: "m-1", enabled: true, scope: { kind: "agent", userId: "a-7" } }),
      { wrapper },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const names = channels.map((c) => c.name);
    expect(names.some((n) => n.includes("order_presence:agent:a-7"))).toBe(true);
    // The market topic is manager-only in realtime.messages RLS; an agent
    // joining it would be refused anyway, and asking is a bug.
    expect(names.some((n) => n.includes("order_presence:market:"))).toBe(false);
  });

  test("othersOn excludes the viewer's own row", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          data: [
            { order_id: "o-1", user_id: "me", role: "agent", mode: "editing",
              opened_at: NOW.toISOString(), expires_at: soon(75) },
            { order_id: "o-1", user_id: "mgr", role: "market_manager", mode: "viewing",
              opened_at: NOW.toISOString(), expires_at: soon(75) },
          ],
          server_now: NOW.toISOString(),
        }),
      } as Response));

    const { result } = renderHook(
      () =>
        useOrderLocks({
          marketId: "m-1",
          enabled: true,
          scope: { kind: "agent", userId: "me" },
          selfId: "me",
        }),
      { wrapper },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });

    const others = result.current.othersOn("o-1");
    expect(others.map((r) => r.user_id)).toEqual(["mgr"]);
  });
});
