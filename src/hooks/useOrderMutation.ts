"use client";

import { useRef } from "react";
import { useSWRConfig } from "swr";
import { useRealtime } from "@/components/providers/RealtimeProvider";

/**
 * A save that lost a race: somebody else wrote the order between the moment
 * this client last read it and the moment it tried to save.
 *
 * `fresh` is the winner's order in the same shape GET returns, so the caller
 * can put it straight into the cache and show the user what actually happened
 * rather than a rollback to a value that is also stale.
 */
export class OrderConflictError extends Error {
  readonly fresh: Record<string, unknown>;
  constructor(message: string, fresh: Record<string, unknown>) {
    super(message);
    this.name = "OrderConflictError";
    this.fresh = fresh;
  }
}

interface OrderItemSeed {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  variant_id?: string | null;
  variant_label?: string | null;
}

/**
 * The only three fields that can move an order's destination. `customer_address`
 * is NOT one of them: it is free text the rates route never reads, so re-quoting
 * on it would hit the carrier path for edits that cannot change the price.
 */
const DESTINATION_FIELDS = ["darb_destination_id", "city_id", "dexpress_state_id"] as const;

export function useOrderMutation(orderId: string) {
  const { mutate, cache } = useSWRConfig();
  const { editLock } = useRealtime();
  const key = `/api/orders/${orderId}`;
  // Monotonic id — if two commits race, only the last response is applied
  const commitIdRef = useRef(0);
  /**
   * The `updated_at` this client last saw FROM THE SERVER, used as the save
   * precondition. Deliberately not read from the SWR cache: `commit` writes an
   * optimistic row there, so two quick edits by the same user would send the
   * value the second edit typed over and the user's own save would conflict
   * with their own previous one.
   */
  const serverStampRef = useRef<string | null>(null);
  /** Commits are serialised per order, so the stamp is never read mid-flight. */
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Move the precondition forward, never backward.
   *
   * The panel re-seeds from whatever sits in the cache, and that can be an
   * OLDER row than the one a save just returned: a realtime event patches
   * `updated_at` in place, and a revalidation that started before the save can
   * land after it. Taking such a row would send a stamp the server has already
   * moved past, and the user's next edit would 409 against their own save.
   */
  function rememberStamp(row: unknown) {
    const stamp = (row as { updated_at?: unknown } | null | undefined)?.updated_at;
    if (typeof stamp !== "string") return;
    const current = serverStampRef.current;
    if (current !== null) {
      const next = Date.parse(stamp);
      const held = Date.parse(current);
      // Compare as instants; fall through on an unparseable value rather than
      // pinning the ref to something we cannot order.
      if (!Number.isNaN(next) && !Number.isNaN(held) && next < held) return;
    }
    serverStampRef.current = stamp;
  }

  async function commit(updates: Record<string, unknown>): Promise<void> {
    // Wait for any commit already in flight: overlapping saves would both read
    // the same stamp and the second would be a guaranteed false conflict.
    const previous = inFlightRef.current;
    let release: () => void = () => {};
    inFlightRef.current = new Promise<void>((r) => {
      release = r;
    });
    await previous.catch(() => {});

    const thisId = ++commitIdRef.current;
    editLock.lock("orders", orderId);

    const body: Record<string, unknown> = { ...updates };
    if (serverStampRef.current) body.expected_updated_at = serverStampRef.current;

    try {
      await mutate(
        key,
        async (current: unknown) => {
          const res = await fetch(key, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const err = await res.json();
            if (err?.code === "conflict" && err.data) {
              // Adopt the winner's stamp so an immediate retry is a real save
              // and not a second conflict against the same known-stale value.
              rememberStamp(err.data);
              throw new OrderConflictError(
                err.error ?? "Modifiée entre-temps",
                err.data as Record<string, unknown>,
              );
            }
            throw new Error(err.error ?? "Request failed");
          }

          // Drop stale responses when a newer commit has already resolved
          if (thisId !== commitIdRef.current) return current;

          const json = await res.json();
          rememberStamp(json.data);

          // Belt and braces alongside the destination-keyed rates hook: that key
          // protects the LIVE quote, but a cached entry under the OLD
          // destination would be served again the moment the agent edits back
          // within the 60 s dedupe window.
          //
          // Evicted straight from the cache, not through a filtered mutate:
          // SWR's key-filter form only visits keys with a mounted subscriber,
          // and the carrier sheet is usually closed when the destination is
          // edited — so the very entries that go stale are the ones a filtered
          // mutate skips. Verified: a filtered mutate left a seeded, unmounted
          // key untouched.
          if (DESTINATION_FIELDS.some((f) => f in updates)) {
            const prefix = `/api/carriers/rates?order_id=${orderId}`;
            for (const k of [...(cache as unknown as Map<string, unknown>).keys()]) {
              if (typeof k === "string" && k.startsWith(prefix)) cache.delete(k);
            }
          }

          return { data: json.data };
        },
        {
          optimisticData: (current: unknown) => {
            const c = current as { data: Record<string, unknown> } | undefined;
            if (!c) return current;
            return { data: { ...c.data, ...updates } };
          },
          rollbackOnError: true,
          revalidate: false,
          throwOnError: true,
        }
      );
    } finally {
      editLock.unlock("orders", orderId);
      release();
    }
  }

  /**
   * Optimistically appends a synthetic line item to the cached order, then POSTs
   * to /api/orders/{id}/items. On success the temp row is replaced by the server-
   * returned item; on failure the optimistic change rolls back.
   *
   * The server recomputes orders.total_price and orders.quantity, so we trigger
   * a revalidation after the POST resolves to pick up the recomputed totals.
   */
  async function addItemOptimistic(seed: OrderItemSeed): Promise<void> {
    const itemsKey = `${key}/items`;
    const tempId = `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lineTotal = Math.round(seed.unit_price * seed.quantity * 1000) / 1000;
    const tempItem = {
      id: tempId,
      order_id: orderId,
      product_id: seed.product_id,
      product_name: seed.product_name,
      variant_id: seed.variant_id ?? null,
      variant_label: seed.variant_label ?? null,
      quantity: seed.quantity,
      unit_price: seed.unit_price,
      line_total: lineTotal,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    editLock.lock("orders", orderId);
    try {
      await mutate(
        key,
        async (current: unknown) => {
          const body: Record<string, unknown> = {
            product_id: seed.product_id,
            quantity: seed.quantity,
            unit_price: seed.unit_price,
          };
          if (seed.variant_id) body.variant_id = seed.variant_id;

          const res = await fetch(itemsKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? "Failed to add item");
          }

          const json = await res.json();
          const newItem = json.data;

          const c = current as
            | { data: { order_items?: unknown[] } & Record<string, unknown> }
            | undefined;
          if (!c?.data) {
            return { data: { order_items: [newItem] } };
          }

          const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
          const replaced = items.some((it) => (it as { id?: string }).id === tempId)
            ? items.map((it) =>
                (it as { id?: string }).id === tempId ? newItem : it,
              )
            : [...items, newItem];

          return { data: { ...c.data, order_items: replaced } };
        },
        {
          optimisticData: (current: unknown) => {
            const c = current as
              | { data: { order_items?: unknown[] } & Record<string, unknown> }
              | undefined;
            if (!c?.data) {
              return { data: { order_items: [tempItem] } };
            }
            const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
            return { data: { ...c.data, order_items: [...items, tempItem] } };
          },
          rollbackOnError: true,
          // Re-validate so we get the recomputed total_price and quantity from the server.
          revalidate: true,
          throwOnError: true,
        },
      );
    } finally {
      editLock.unlock("orders", orderId);
    }
  }

  /**
   * Optimistically patches an existing line item in the cached order, then PATCHes
   * /api/orders/{id}/items/{itemId}. Locks the order for the duration so concurrent
   * realtime events don't clobber the in-flight edit. On success the cached row is
   * replaced by the server-returned item; on failure the optimistic change rolls back.
   *
   * The server recomputes orders.total_price and orders.quantity, so we revalidate
   * after the PATCH resolves to pick up the recomputed totals.
   */
  async function patchItemOptimistic(
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const itemUrl = `${key}/items/${itemId}`;

    function patchRow(it: Record<string, unknown>): Record<string, unknown> {
      const merged = { ...it, ...body };
      const qty = Number(merged.quantity ?? it.quantity ?? 0);
      const price = Number(merged.unit_price ?? it.unit_price ?? 0);
      merged.line_total = Math.round(qty * price * 1000) / 1000;
      return merged;
    }

    editLock.lock("orders", orderId);
    try {
      await mutate(
        key,
        async (current: unknown) => {
          const res = await fetch(itemUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? "Failed to update item");
          }

          const json = await res.json();
          const updated = json.data as Record<string, unknown>;

          const c = current as
            | { data: { order_items?: unknown[] } & Record<string, unknown> }
            | undefined;
          if (!c?.data) return current;

          const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
          const replaced = items.map((it) =>
            (it as { id?: string }).id === itemId ? updated : it,
          );
          return { data: { ...c.data, order_items: replaced } };
        },
        {
          optimisticData: (current: unknown) => {
            const c = current as
              | { data: { order_items?: unknown[] } & Record<string, unknown> }
              | undefined;
            if (!c?.data) return current;
            const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
            const next = items.map((it) =>
              (it as { id?: string }).id === itemId
                ? patchRow(it as Record<string, unknown>)
                : it,
            );
            return { data: { ...c.data, order_items: next } };
          },
          rollbackOnError: true,
          revalidate: true,
          throwOnError: true,
        },
      );
    } finally {
      editLock.unlock("orders", orderId);
    }
  }

  /**
   * Optimistically removes a line item from the cached order, then DELETEs
   * /api/orders/{id}/items/{itemId}. Locks the order for the duration. On failure
   * the optimistic removal rolls back. Revalidates to pick up recomputed totals.
   */
  async function deleteItemOptimistic(itemId: string): Promise<void> {
    const itemUrl = `${key}/items/${itemId}`;

    editLock.lock("orders", orderId);
    try {
      await mutate(
        key,
        async (current: unknown) => {
          const res = await fetch(itemUrl, { method: "DELETE" });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? "Failed to remove item");
          }

          const c = current as
            | { data: { order_items?: unknown[] } & Record<string, unknown> }
            | undefined;
          if (!c?.data) return current;

          const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
          const next = items.filter((it) => (it as { id?: string }).id !== itemId);
          return { data: { ...c.data, order_items: next } };
        },
        {
          optimisticData: (current: unknown) => {
            const c = current as
              | { data: { order_items?: unknown[] } & Record<string, unknown> }
              | undefined;
            if (!c?.data) return current;
            const items = Array.isArray(c.data.order_items) ? c.data.order_items : [];
            const next = items.filter((it) => (it as { id?: string }).id !== itemId);
            return { data: { ...c.data, order_items: next } };
          },
          rollbackOnError: true,
          revalidate: true,
          throwOnError: true,
        },
      );
    } finally {
      editLock.unlock("orders", orderId);
    }
  }

  /**
   * Seed the precondition from a row the caller already has (a GET response, a
   * realtime patch). Without it the first save of a freshly-opened panel would
   * go unguarded.
   */
  function noteServerRow(row: unknown) {
    rememberStamp(row);
  }

  return {
    commit,
    addItemOptimistic,
    patchItemOptimistic,
    deleteItemOptimistic,
    noteServerRow,
  };
}
