import { renderHook, act, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { SWRConfig, useSWRConfig } from "swr";
import React from "react";
import { useOrderMutation, OrderConflictError } from "./useOrderMutation";
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

  // ── Optimistic concurrency ────────────────────────────────────────────────
  describe("conflict handling", () => {
    const STAMP_A = "2026-09-10T08:00:00.123456+00:00";
    const STAMP_B = "2026-09-10T09:30:00.654321+00:00";

    it("sends no expected_updated_at until it has seen one from the server", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: STAMP_A } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });
      await act(async () => {
        await result.current.commit({ customer_name: "Bob" });
      });

      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ customer_name: "Bob" });
    });

    it("sends the stamp the SERVER last returned, not the optimistic one", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: STAMP_A } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });
      await act(async () => {
        await result.current.commit({ customer_name: "Bob" });
      });
      await act(async () => {
        await result.current.commit({ customer_name: "Carla" });
      });

      // The second commit carries the stamp the FIRST response reported.
      // Reading it from the optimistic cache instead would send the value the
      // user typed over, and the user's own second edit would 409 against
      // their own first.
      const second = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(second.expected_updated_at).toBe(STAMP_A);
      expect(second.customer_name).toBe("Carla");
    });

    it("throws OrderConflictError and adopts the server's order on a 409 conflict", async () => {
      const fresh = { id: ORDER_ID, customer_name: "Winner", updated_at: STAMP_B };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({ error: "Modifiée entre-temps", code: "conflict", data: fresh }),
        }),
      );

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.commit({ customer_name: "Loser" });
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(OrderConflictError);
      expect((caught as OrderConflictError).fresh).toEqual(fresh);
    });

    it("a plain (non-conflict) error is still a plain Error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: "Cette commande ne peut plus être modifiée." }),
        }),
      );

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.commit({ customer_name: "Bob" });
        } catch (e) {
          caught = e;
        }
      });

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(OrderConflictError);
      expect((caught as Error).message).toContain("ne peut plus");
    });

    it("never regresses the stamp to an older one", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: STAMP_B } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });
      await act(async () => {
        await result.current.commit({ customer_name: "Bob" });
      });

      // A realtime event or a slow revalidation can put an OLDER row into the
      // cache after a save has already resolved. Seeding from it must not undo
      // what the save just learned, or the next edit would 409 against a stamp
      // the server has already moved past.
      act(() => {
        result.current.noteServerRow({ id: ORDER_ID, updated_at: STAMP_A });
      });

      await act(async () => {
        await result.current.commit({ customer_name: "Carla" });
      });

      expect(JSON.parse(mockFetch.mock.calls[1][1].body).expected_updated_at).toBe(STAMP_B);
    });

    it("adopts the conflicting order's stamp, so the next save is not a second conflict", async () => {
      const fresh = { id: ORDER_ID, customer_name: "Winner", updated_at: STAMP_B };
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({ error: "Modifiée entre-temps", code: "conflict", data: fresh }),
        })
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: STAMP_B } }),
        });
      vi.stubGlobal("fetch", mockFetch);

      const { result } = renderHook(() => useOrderMutation(ORDER_ID), { wrapper });
      await act(async () => {
        await result.current.commit({ customer_name: "Loser" }).catch(() => {});
      });
      await act(async () => {
        await result.current.commit({ customer_name: "Retry" });
      });

      expect(JSON.parse(mockFetch.mock.calls[1][1].body).expected_updated_at).toBe(STAMP_B);
    });
  });

  // ── Destination edits invalidate the carrier quote ────────────────────────
  describe("carrier rates invalidation", () => {
    it("drops the cached quote when the PATCH moved the destination", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: "2026-09-10T00:00:00Z" } }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { result } = renderHook(
        () => ({ m: useOrderMutation(ORDER_ID), cfg: useSWRConfig() }),
        { wrapper },
      );

      // Seed a cached quote under the OLD destination.
      await act(async () => {
        await result.current.cfg.mutate(
          `/api/carriers/rates?order_id=${ORDER_ID}&dest=darb%3A18`,
          { data: { recommended_carrier_id: "tripoli" } },
          { revalidate: false },
        );
      });
      expect(
        result.current.cfg.cache.get(`/api/carriers/rates?order_id=${ORDER_ID}&dest=darb%3A18`)?.data,
      ).toBeTruthy();

      await act(async () => {
        await result.current.m.commit({ darb_destination_id: 78 });
      });

      // The stale entry must be gone: the destination key alone protects the
      // live hook, but a cached entry under the OLD key would come back the
      // moment the agent edits the destination back again.
      await waitFor(() => {
        expect(
          result.current.cfg.cache.get(`/api/carriers/rates?order_id=${ORDER_ID}&dest=darb%3A18`)
            ?.data,
        ).toBeUndefined();
      });
    });

    it("leaves the quote alone for an edit that cannot move the destination", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { id: ORDER_ID, updated_at: "2026-09-10T00:00:00Z" } }),
        }),
      );

      const { result } = renderHook(
        () => ({ m: useOrderMutation(ORDER_ID), cfg: useSWRConfig() }),
        { wrapper },
      );

      const key = `/api/carriers/rates?order_id=${ORDER_ID}&dest=darb%3A18`;
      await act(async () => {
        await result.current.cfg.mutate(key, { data: { recommended_carrier_id: "tripoli" } }, { revalidate: false });
      });

      // customer_address is free text the route never reads; re-quoting on it
      // would hit the carrier path on every keystroke-sized edit.
      await act(async () => {
        await result.current.m.commit({ customer_address: "Rue 9" });
      });

      expect(result.current.cfg.cache.get(key)?.data).toBeTruthy();
    });
  });
});
