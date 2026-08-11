import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";

/**
 * /api/settings/:marketId is gated by canReadSettings, which returns false for
 * `agent` — super_admin and market_manager only. But OrderDetailPanel calls
 * useMaxCallAttempts on every open, so every agent opening an order fired a 403.
 *
 * The visible cost was not the console noise: the hook returns null on failure
 * and callers "fall back to the bare count, never to a guessed maximum", so
 * agents simply never saw the denominator. Libya's ceiling is 8 and Tunisia's
 * is 9, and the status enum stops at attempt_3 — so the counter is exactly the
 * thing an agent needs and exactly what they were not getting.
 *
 * /api/agent/settings is the sanctioned equivalent and returns the same setting
 * for the agent's own market.
 */
const mockUser: { role: string; market_id: string | null } = {
  role: "agent",
  market_id: "m-ly",
};

vi.mock("@/context/auth", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

import { useMaxCallAttempts } from "../useMaxCallAttempts";

const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useMaxCallAttempts", () => {
  test("an agent reads /api/agent/settings, never the manager-only route", async () => {
    mockUser.role = "agent";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ max_call_attempts: 8 }),
    });

    const { result } = renderHook(() => useMaxCallAttempts("m-ly"), { wrapper });

    await waitFor(() => expect(result.current).toBe(8));

    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called).toContain("/api/agent/settings");
    expect(called.some((u) => u.startsWith("/api/settings/"))).toBe(false);
  });

  test("a market_manager still reads the per-market settings route", async () => {
    mockUser.role = "market_manager";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ key: "max_call_attempts", value: { value: 9 } }] }),
    });

    const { result } = renderHook(() => useMaxCallAttempts("m-tn"), { wrapper });

    await waitFor(() => expect(result.current).toBe(9));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      "/api/settings/m-tn",
    );
  });

  test("returns null rather than a guessed ceiling when the request fails", async () => {
    mockUser.role = "market_manager";
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    const { result } = renderHook(() => useMaxCallAttempts("m-tn"), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  test("an agent needs no marketId — the endpoint is scoped to their own market", async () => {
    mockUser.role = "agent";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ max_call_attempts: 8 }),
    });

    const { result } = renderHook(() => useMaxCallAttempts(null), { wrapper });

    await waitFor(() => expect(result.current).toBe(8));
  });
});
