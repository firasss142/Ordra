"use client";

import useSWR from "swr";
import { useCallback, useState } from "react";

export interface AgentAvailability {
  is_available: boolean;
  available_since: string | null;
  last_seen_at: string | null;
  /** Declared AND beating — what the distributor actually checks. */
  receiving_orders: boolean;
}

export interface ToggleResult {
  changed: boolean;
  /** Untouched orders handed back to the pool by turning off. */
  released: number;
}

const KEY = "/api/agent/availability";

/**
 * The agent's own readiness switch.
 *
 * Polls on a slow interval as a safety net: readiness can change without this
 * tab doing anything — a manager can force an agent off, and the midnight
 * reset turns everyone off — and a stale toggle that claims "you are
 * receiving orders" while the queue stays empty is the worst version of this
 * feature.
 */
export function useAgentAvailability(enabled: boolean) {
  const { data, mutate, isLoading } = useSWR<{ data: AgentAvailability }>(
    enabled ? KEY : null,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  const [pending, setPending] = useState(false);

  const setAvailable = useCallback(
    async (next: boolean): Promise<ToggleResult | null> => {
      setPending(true);
      try {
        const res = await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_available: next }),
        });
        if (!res.ok) return null;

        const body = (await res.json()) as { data?: ToggleResult };
        await mutate();

        // Turning ON pulls whatever is waiting. Fire-and-forget: the queue is
        // realtime, so the rows arrive on their own, and making the toggle
        // wait on a 500-order drain would freeze the button.
        if (next) {
          void fetch("/api/agent/availability/drain", { method: "POST" }).catch(() => {});
        }

        return body.data ?? { changed: true, released: 0 };
      } catch {
        return null;
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );

  return {
    availability: data?.data ?? null,
    isLoading,
    pending,
    setAvailable,
    refresh: mutate,
  };
}
