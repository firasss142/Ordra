"use client";

import { useRef } from "react";
import { useSWRConfig } from "swr";
import { useRealtime } from "@/components/providers/RealtimeProvider";

interface OrderItemSeed {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  variant_id?: string | null;
  variant_label?: string | null;
}

export function useOrderMutation(orderId: string) {
  const { mutate } = useSWRConfig();
  const { editLock } = useRealtime();
  const key = `/api/orders/${orderId}`;
  // Monotonic id — if two commits race, only the last response is applied
  const commitIdRef = useRef(0);

  async function commit(updates: Record<string, unknown>): Promise<void> {
    const thisId = ++commitIdRef.current;
    editLock.lock("orders", orderId);

    try {
      await mutate(
        key,
        async (current: unknown) => {
          const res = await fetch(key, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error ?? "Request failed");
          }

          // Drop stale responses when a newer commit has already resolved
          if (thisId !== commitIdRef.current) return current;

          const json = await res.json();
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

  return { commit, addItemOptimistic };
}
