"use client";

import useSWR from "swr";
import { useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface SyncRun {
  id: string;
  storefront_id: string;
  trigger: "cron" | "manual";
  status: "running" | "succeeded" | "partial" | "failed" | "skipped_locked";
  started_at: string;
  finished_at: string | null;
  rows_fetched: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_errored: number;
  has_more: boolean;
  error: string | null;
}

export interface FailedRow {
  id: string;
  storefront_id: string;
  row_index: number;
  message: string;
  raw_row: Record<string, unknown>;
  created_at: string;
}

interface SourceStatus {
  storefront_id: string;
  platform: string;
  is_active: boolean;
  last_row: number;
  /** May still be in flight. */
  last_run: SyncRun | null;
  /** The last run that actually landed rows — what "working" means. */
  last_success: SyncRun | null;
  open_failures: number;
}

interface SyncStatusData {
  sources: SourceStatus[];
  configs_count: number;
  failures: FailedRow[];
}

/**
 * How long without a completed run before the widget calls it broken.
 * Mirrors SYNC_STALE_MINUTES in the alerts route — the page and the alert must
 * not disagree about whether the import is working.
 */
const STALE_MINUTES = 45;

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

  /**
   * Is the import actually working?
   *
   * Deliberately not "did the last run fail": for four days every run was
   * started and then killed at 55 seconds, so the newest row was perpetually
   * `running` and nothing ever recorded a failure. Absence of a *completed*
   * run is the signal that catches that.
   */
  const sources = data?.sources ?? [];
  const staleBefore = Date.now() - STALE_MINUTES * 60_000;
  const brokenSources = sources.filter((s) => {
    if (!s.is_active) return false;
    if (s.last_run?.status === "failed") return true;
    const at = s.last_success?.finished_at ?? s.last_success?.started_at;
    return !at || new Date(at).getTime() < staleBefore;
  });

  return {
    status: data ?? null,
    isLoading,
    isSyncing,
    syncError,
    triggerSync,
    hasSheets: (data?.configs_count ?? 0) > 0,
    isBroken: brokenSources.length > 0,
    brokenSources,
    failures: data?.failures ?? [],
    lastSuccessAt:
      sources
        .map((s) => s.last_success?.finished_at ?? null)
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null,
  };
}
