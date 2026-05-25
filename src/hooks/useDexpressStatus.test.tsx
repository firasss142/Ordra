import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { useDexpressStatus } from "./useDexpressStatus";

const ORDER_ID = "order-uuid-1";
const KEY = `/api/orders/${ORDER_ID}/dexpress-status`;

function wrapper({ children }: { children: React.ReactNode }) {
  // Fresh cache per test, dedupe disabled so each hook render fetches.
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDexpressStatus — enabled gate", () => {
  test("does NOT fetch when enabled is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, false),
      { wrapper }
    );

    // Give SWR a tick — if it were going to fire, this is when.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  test("does NOT fetch when orderId is empty even if enabled=true", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useDexpressStatus("", true), { wrapper });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDexpressStatus — happy path (kind:ok)", () => {
  test("fetches the snapshot endpoint and returns the parsed body", async () => {
    const snapshot = {
      kind: "ok" as const,
      trackingNumber: "1343188",
      slug: "IN_COMPANY" as const,
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    };
    vi.stubGlobal("fetch", mockFetchOnce({ status: 200, body: snapshot }));

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });

    expect(result.current.snapshot).toEqual(snapshot);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    expect(global.fetch).toHaveBeenCalledWith(KEY);
  });
});

describe("useDexpressStatus — not_found is a snapshot, not an error", () => {
  test("404 with kind:not_found body resolves to snapshot, error stays null", async () => {
    const notFoundBody = {
      kind: "not_found" as const,
      trackingNumber: "1343188",
    };
    vi.stubGlobal("fetch", mockFetchOnce({ status: 404, body: notFoundBody }));

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });

    expect(result.current.snapshot).toEqual(notFoundBody);
    expect(result.current.error).toBeNull();
  });
});

describe("useDexpressStatus — error paths", () => {
  test("OMS-side 404 with {error:'Not found'} surfaces as error, not snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ status: 404, body: { error: "Not found" } })
    );

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  test("502 from upstream Dexpress failure surfaces as error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({
        status: 502,
        body: { error: "DEXPRESS_FETCH_FAILED", message: "timeout" },
      })
    );

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
  });

  test("400 (carrier not Dexpress / no tracking) surfaces as error", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({
        status: 400,
        body: { error: "Order carrier is not Dexpress" },
      })
    );

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
  });
});

describe("useDexpressStatus — refresh()", () => {
  test("refresh() triggers a re-fetch", async () => {
    const firstSnapshot = {
      kind: "ok" as const,
      trackingNumber: "1343188",
      slug: "IN_COMPANY" as const,
      statusId: 3,
      rawLabel: "فى الشركة",
      isAccepted: true,
    };
    const secondSnapshot = { ...firstSnapshot, slug: "OUT_FOR_DELIVERY" as const, statusId: 7, rawLabel: "جارى التوصيل" };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(firstSnapshot),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(secondSnapshot),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useDexpressStatus(ORDER_ID, true),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.snapshot).toEqual(firstSnapshot);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.snapshot).toEqual(secondSnapshot);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
