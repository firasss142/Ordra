"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AssignmentAlgorithm } from "@/types/settings";

export interface AssignmentRule {
  algorithm: AssignmentAlgorithm;
  config: Record<string, unknown> | null;
  is_active: boolean;
}

export function useAssignmentRule(marketId: string | null) {
  const key = marketId ? `/api/assignment-rules?market_id=${marketId}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: AssignmentRule }>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  );

  async function update(patch: {
    algorithm?: AssignmentAlgorithm;
    is_active?: boolean;
    config?: Record<string, unknown> | null;
  }) {
    const body = marketId ? { market_id: marketId, ...patch } : patch;
    const res = await fetch("/api/assignment-rules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to update assignment rule");
    await mutate();
  }

  return {
    rule: data?.data ?? null,
    error,
    isLoading,
    mutate,
    update,
  };
}
