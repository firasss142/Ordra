"use client";

import useSWR from "swr";
import type { TimezoneCheck } from "@/lib/meta-ads/timezone";

export interface SyncAccountStatus {
  id: string;
  market_id: string;
  market_name: string | null;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string;
  account_timezone: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  timezone: TimezoneCheck;
}

export interface SyncRun {
  id: string;
  ad_account_id: string;
  trigger: "cron" | "manual";
  status: "running" | "succeeded" | "partial" | "failed" | "skipped_locked";
  started_at: string;
  finished_at: string | null;
  rows_fetched: number;
  rows_upserted: number;
  rows_errored: number;
  error: string | null;
}

export interface SyncStatus {
  accounts: SyncAccountStatus[];
  last_run: SyncRun | null;
  campaigns: number;
  cadence: { schedule: string; active: boolean } | null;
  last_error: string | null;
}

const fetcher = async (url: string): Promise<{ data: SyncStatus }> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`sync status ${res.status}`);
  return res.json();
};

export function useAdSpendSyncStatus(marketId: string) {
  const key = marketId ? `/api/ad-spend/sync-status?market_id=${marketId}` : null;

  const { data, error, isLoading, mutate } = useSWR<{ data: SyncStatus }>(key, fetcher, {
    revalidateOnFocus: false,
    // A run in flight resolves within a minute or so; this keeps the strip from
    // showing "running" long after it finished without hammering the endpoint.
    refreshInterval: 60_000,
  });

  return { status: data?.data ?? null, isLoading, error, mutate };
}
