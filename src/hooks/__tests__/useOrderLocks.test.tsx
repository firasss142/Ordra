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
