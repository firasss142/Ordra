"use client";

import { useRef } from "react";
import { useSWRConfig } from "swr";

export function useOrderMutation(orderId: string) {
  const { mutate } = useSWRConfig();
  const key = `/api/orders/${orderId}`;
  // Monotonic id — if two commits race, only the last response is applied
  const commitIdRef = useRef(0);

  async function commit(updates: Record<string, unknown>): Promise<void> {
    const thisId = ++commitIdRef.current;

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
  }

  return { commit };
}
