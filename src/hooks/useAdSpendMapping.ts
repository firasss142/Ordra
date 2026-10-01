"use client";

import useSWR from "swr";
import type { MappingDraftBody, MappingPreviewDTO, MappingTreeDTO } from "@/lib/ad-spend/mapping-types";

/**
 * The mapping drawer's tree: catalogue, spend, mapping in force, history —
 * over the whole history, not the page's period: a mapping holds for all of
 * it, and one key means the page's badge and the drawer share one fetch.
 */
export function useAdSpendMapping(params: { marketId: string; enabled?: boolean }) {
  const enabled = params.enabled ?? true;
  const key = enabled && params.marketId ? `/api/meta/mapping?market_id=${params.marketId}` : null;

  const { data, error, isLoading, mutate } = useSWR<MappingTreeDTO>(
    key,
    async (url: string) => {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`mapping ${res.status}`);
      return (await res.json()).data as MappingTreeDTO;
    },
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return { tree: data ?? null, error, isLoading, mutate };
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `HTTP ${res.status}`);
  return json.data as T;
}

/** What a change would move. Writes nothing. */
export function previewMapping(body: MappingDraftBody, signal?: AbortSignal) {
  return postJson<MappingPreviewDTO>("/api/meta/mapping/preview", body, signal);
}

export interface SaveMappingResult {
  id: string;
  rows_rewritten: number;
  /** Saved, but ad_spend is rewritten by the next sync rather than now. */
  pending_rebuild: boolean;
  preview: MappingPreviewDTO;
}

/** Save one change and rewrite the spend it moves. */
export function saveMapping(body: MappingDraftBody) {
  return postJson<SaveMappingResult>("/api/meta/mapping", body);
}
