"use client";

import useSWR from "swr";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SourceStatus {
  storefront_id: string;
  platform: string;
  is_active: boolean;
  last_row: number;
}

interface SyncStatusData {
  sources: SourceStatus[];
  configs_count: number;
}

export function useGoogleSheetsSync(marketId: string) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data, mutate, isLoading } = useSWR<SyncStatusData>(
    marketId
      ? `/api/google-sheets/sync-status?market_id=${marketId}`
      : null,
    fetcher,
    { refreshInterval: 30_000 }
  );

  async function triggerSync() {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/google-sheets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId }),
      });
      const body = await res.json();
      if (!body.success) {
        setSyncError(body.error ?? "Sync failed");
      }
      await mutate();
    } catch {
      setSyncError("Network error");
    } finally {
      setIsSyncing(false);
    }
  }

  return {
    status: data ?? null,
    isLoading,
    isSyncing,
    syncError,
    triggerSync,
    hasSheets: (data?.configs_count ?? 0) > 0,
  };
}
