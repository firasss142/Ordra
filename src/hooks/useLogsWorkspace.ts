"use client";

import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";

export interface WebhookLogRow {
  id: string;
  source: string | null;
  event: string | null;
  storefront_id: string | null;
  external_id: string | null;
  order_id: string | null;
  status: "processed" | "ignored" | "error" | null;
  error_message: string | null;
  created_at: string;
}

export interface CarrierEventRow {
  id: string;
  carrier_code: string | null;
  source: string | null;
  tracking_number: string | null;
  carrier_status_raw: string | null;
  order_id: string | null;
  outcome: "processed" | "ignored" | "error" | null;
  outcome_reason: string | null;
  created_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

interface WebhookListResponse {
  data: WebhookLogRow[];
  pagination: Pagination;
}

interface CarrierListResponse {
  data: CarrierEventRow[];
  pagination: Pagination;
}

export interface LogsSummary {
  window_minutes: number;
  webhook: {
    total: number;
    failed: number;
    failure_rate: number;
    buckets: { bucket: string; total: number; failed: number }[];
  };
  carrier: {
    total: number;
    failed: number;
    failure_rate: number;
    buckets: { bucket: string; total: number; failed: number }[];
  };
}

export interface UseLogsArgs {
  tab: "webhooks" | "carrier" | "all";
  page: number;
  limit: number;
  failuresOnly: boolean;
  search: string;
  enabled: boolean;
}

export function useWebhookLogs({
  page,
  limit,
  failuresOnly,
  search,
  enabled,
}: Omit<UseLogsArgs, "tab">) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (failuresOnly) params.set("failures_only", "true");
  if (search) params.set("q", search);

  const { data, isLoading, mutate } = useSWR<WebhookListResponse>(
    enabled ? `/api/admin/webhook-logs?${params.toString()}` : null,
    jsonFetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false },
  );

  return {
    rows: data?.data ?? [],
    pagination: data?.pagination,
    isLoading,
    refresh: mutate,
  };
}

export function useCarrierEvents({
  page,
  limit,
  failuresOnly,
  search,
  enabled,
}: Omit<UseLogsArgs, "tab">) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (failuresOnly) params.set("failures_only", "true");
  if (search) params.set("q", search);

  const { data, isLoading, mutate } = useSWR<CarrierListResponse>(
    enabled ? `/api/admin/carrier-events?${params.toString()}` : null,
    jsonFetcher,
    { refreshInterval: 15_000, revalidateOnFocus: false },
  );

  return {
    rows: data?.data ?? [],
    pagination: data?.pagination,
    isLoading,
    refresh: mutate,
  };
}

export function useLogsSummary(windowMinutes = 60) {
  const { data, isLoading, mutate } = useSWR<LogsSummary>(
    `/api/admin/logs/summary?window=${windowMinutes}`,
    jsonFetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false },
  );
  return { summary: data, isLoading, refresh: mutate };
}
