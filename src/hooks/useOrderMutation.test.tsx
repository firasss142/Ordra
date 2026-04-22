import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { useOrderMutation } from "./useOrderMutation";

const ORDER_ID = "order-abc";
const KEY = `/api/orders/${ORDER_ID}`;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOrderMutation", () => {
  it("commit sends PATCH to /api/orders/{id} with updates as JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: ORDER_ID, customer_name: "Bob" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.commit({ customer_name: "Bob" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ customer_name: "Bob" }),
      })
    );
  });

  it("commit resolves successfully on 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: ORDER_ID } }),
      })
    );

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await expect(
      act(async () => {
        await result.current.commit({ customer_name: "Alice" });
      })
    ).resolves.not.toThrow();
  });

  it("commit throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Order not found" }),
      })
    );

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await expect(
      act(async () => {
        await result.current.commit({ customer_name: "Alice" });
      })
    ).rejects.toThrow("Order not found");
  });

  it("returns the onError callback to allow callers to handle errors", () => {
    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });
    expect(typeof result.current.commit).toBe("function");
  });

  it("commit with multiple fields sends all fields in the body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: ORDER_ID } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.commit({
        customer_name: "Alice",
        customer_phone: "555",
      });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ customer_name: "Alice", customer_phone: "555" });
  });
});
