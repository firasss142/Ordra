import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { useDarbStatus } from "./useDarbStatus";

const ORDER_ID = "order-uuid-1";
const KEY = `/api/orders/${ORDER_ID}/darb-status`;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

function mockFetchOnce(opts: { status: number; body: unknown }) {
  return vi.fn().mockResolvedValueOnce({
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    json: () => Promise.resolve(opts.body),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useDarbStatus — enabled gate", () => {
  test("does NOT fetch when enabled is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDarbStatus(ORDER_ID, false), { wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.timeline).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  test("does NOT fetch when orderId is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useDarbStatus("", true), { wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDarbStatus — happy path", () => {
  test("fetches and returns the timeline events", async () => {
    const body = {
      kind: "ok",
      trackingNumber: "SH1584689",
      timeline: [
        { type: "info", labelAr: "تم إنشاء الشحنة", timestamp: "2026-05-07T21:58:12.019Z" },
      ],
    };
    vi.stubGlobal("fetch", mockFetchOnce({ status: 200, body }));

    const { result } = renderHook(() => useDarbStatus(ORDER_ID, true), { wrapper });
    await waitFor(() => expect(result.current.timeline).not.toBeNull());

    expect(result.current.timeline).toEqual(body.timeline);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(KEY);
  });
});

describe("useDarbStatus — error paths", () => {
  test("502 upstream failure surfaces as error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 502, body: { error: "DARB_FETCH_FAILED", message: "x" } }),
    );
    const { result } = renderHook(() => useDarbStatus(ORDER_ID, true), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.timeline).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  test("400 (carrier not Darb) surfaces as error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 400, body: { error: "Order carrier is not Darb Assabil" } }),
    );
    const { result } = renderHook(() => useDarbStatus(ORDER_ID, true), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
