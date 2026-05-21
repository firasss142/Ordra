"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface SheetSource {
  storefront_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  platform: "converty";
  is_active: boolean;
}

export function useGoogleSheetsSources(marketId: string) {
  const { data, mutate, isLoading } = useSWR<{ data: SheetSource[] }>(
    marketId ? `/api/settings/${marketId}/google-sheets-sources` : null,
    fetcher,
    { refreshInterval: 30_000 }
  );

  async function saveSources(sources: SheetSource[]) {
    await mutate({ data: sources }, false);
    const res = await fetch(`/api/settings/${marketId}/google-sheets-sources`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sources),
    });
    if (!res.ok) {
      await mutate();
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? "Save failed");
    }
    await mutate();
  }

  return {
    sources: data?.data ?? [],
    isLoading,
    saveSources,
  };
}
