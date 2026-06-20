import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig } from "swr";
import React from "react";
import { useOrderMutation } from "./useOrderMutation";
import { RealtimeProvider } from "@/components/providers/RealtimeProvider";

const ORDER_ID = "order-abc";
const KEY = `/api/orders/${ORDER_ID}`;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      subscribe: () => ({}),
    }),
    removeChannel: () => {},
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RealtimeProvider>{children}</RealtimeProvider>
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

  it("addItemOptimistic POSTs to /api/orders/{id}/items with product_id, quantity, unit_price", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "item-new",
            order_id: ORDER_ID,
            product_id: "p-1",
            product_name: "iPhone 15",
            quantity: 1,
            unit_price: 2200,
            line_total: 2200,
          },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.addItemOptimistic({
        product_id: "p-1",
        product_name: "iPhone 15",
        quantity: 1,
        unit_price: 2200,
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${KEY}/items`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ product_id: "p-1", quantity: 1, unit_price: 2200 });
  });

  it("addItemOptimistic forwards variant_id when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: "item-new" } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.addItemOptimistic({
        product_id: "p-1",
        product_name: "iPhone 15",
        quantity: 2,
        unit_price: 2200,
        variant_id: "v-1",
      });
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variant_id).toBe("v-1");
  });

  it("addItemOptimistic throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Product is out of stock" }),
      })
    );

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await expect(
      act(async () => {
        await result.current.addItemOptimistic({
          product_id: "p-1",
          product_name: "iPhone 15",
          quantity: 1,
          unit_price: 2200,
        });
      })
    ).rejects.toThrow("Product is out of stock");
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

  it("patchItemOptimistic sends PATCH to /api/orders/{id}/items/{itemId} with body as JSON", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            id: "item-1",
            order_id: ORDER_ID,
            unit_price: 50,
            quantity: 1,
            line_total: 50,
          },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.patchItemOptimistic("item-1", { unit_price: 50 });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${KEY}/items/item-1`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ unit_price: 50 });
  });

  it("patchItemOptimistic throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "unit_price must be >= 0" }),
      })
    );

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await expect(
      act(async () => {
        await result.current.patchItemOptimistic("item-1", { unit_price: -5 });
      })
    ).rejects.toThrow("unit_price must be >= 0");
  });

  it("deleteItemOptimistic sends DELETE to /api/orders/{id}/items/{itemId}", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await act(async () => {
      await result.current.deleteItemOptimistic("item-1");
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `${KEY}/items/item-1`,
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deleteItemOptimistic throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Cannot remove the last item from an order" }),
      })
    );

    const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

    await expect(
      act(async () => {
        await result.current.deleteItemOptimistic("item-1");
      })
    ).rejects.toThrow("Cannot remove the last item from an order");
  });
});
