"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { FeedbackCategory, ComplaintStatus } from "@/lib/feedback/taxonomy";
import type {
  FeedbackContext,
  FeedbackLookupResult,
  FeedbackOverviewResponse,
  FeedbackRowsResponse,
  FeedbackTopic,
  MyFeedbackRow,
} from "@/types/feedback";

/**
 * « Voix du client » data. `market` is only ever sent for a super_admin (the scope switcher's
 * market); everyone else's market comes from their session on the server.
 *
 * The global SWR config keeps previous data across key changes; every hook below whose key
 * carries a query turns that off, or a new filter would show the old filter's rows.
 */
const withMarket = (path: string, market: string | null | undefined) =>
  market ? `${path}${path.includes("?") ? "&" : "?"}market_id=${market}` : path;

const FRESH = { keepPreviousData: false } as const;

export function useFeedbackTopics(market: string | null | undefined, enabled = true) {
  const { data } = useSWR<{ data: FeedbackTopic[] }>(enabled ? withMarket("/api/feedback/topics", market) : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60_000,
  });
  return Array.isArray(data?.data) ? data.data : [];
}

export function useFeedbackContext(orderId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ data: FeedbackContext }>(
    orderId ? `/api/feedback/context?order_id=${orderId}` : null,
    fetcher,
    { ...FRESH, revalidateOnFocus: false },
  );
  return { context: data?.data ?? null, error, isLoading, mutate };
}

export function useFeedbackLookup(q: string, market: string | null | undefined) {
  const term = q.trim();
  const { data, isLoading } = useSWR<{ data: FeedbackLookupResult }>(
    term.length >= 3 ? withMarket(`/api/feedback/lookup?q=${encodeURIComponent(term)}`, market) : null,
    fetcher,
    { ...FRESH, revalidateOnFocus: false },
  );
  return { result: data?.data ?? null, isLoading };
}

export function useMyFeedback(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<{ data: MyFeedbackRow[] }>(enabled ? "/api/feedback/mine" : null, fetcher);
  return { rows: Array.isArray(data?.data) ? data.data : null, error, isLoading, mutate };
}

/** `{ phone_normalized: count }` of customers with an open complaint. */
export function useOpenComplaints(enabled: boolean, market?: string | null) {
  const { data } = useSWR<{ data: Record<string, number> }>(
    enabled ? withMarket("/api/feedback/open-complaints", market) : null,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  return data?.data ?? {};
}

export interface OverviewQuery {
  from: string | null;
  to: string | null;
  family: string | null;
  agent: string | null;
  cat: FeedbackCategory | null;
}

const qs = (o: Record<string, string | number | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export function useFeedbackOverview(q: OverviewQuery, market: string | null | undefined, enabled = true) {
  const key = enabled ? withMarket(`/api/feedback/overview?${qs({ ...q })}`, market) : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: FeedbackOverviewResponse }>(key, fetcher, FRESH);
  return { overview: data?.data ?? null, error, isLoading, mutate };
}

export interface RowsQuery extends OverviewQuery {
  topic: string | null;
  mode: "period" | "review" | "late";
  limit: number;
}

export function useFeedbackRows(q: RowsQuery, market: string | null | undefined, enabled = true) {
  const key = enabled ? withMarket(`/api/feedback/rows?${qs({ ...q })}`, market) : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: FeedbackRowsResponse }>(key, fetcher, {
    // « Voir n de plus » grows the limit: keep the rows on screen while the longer page loads.
    keepPreviousData: true,
  });
  return { rows: data?.data?.rows ?? null, total: data?.data?.total ?? 0, error, isLoading, mutate };
}

export function useFeedbackDays(from: string | null, to: string | null, family: string | null, market: string | null | undefined) {
  const key = from && to ? withMarket(`/api/feedback/days?${qs({ from, to, family })}`, market) : null;
  const { data } = useSWR<{ data: string[] }>(key, fetcher, { ...FRESH, revalidateOnFocus: false });
  return new Set(Array.isArray(data?.data) ? data.data : []);
}

// ── writes ──────────────────────────────────────────────────────────────────

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
  return (json as { data: T }).data;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  body: string;
  topic_id: string | null;
  order_id: string | null;
  customer_id?: string | null;
  product_id?: string | null;
  market_id?: string | null;
}

export const createFeedback = (input: CreateFeedbackInput) =>
  send<{ id: string; moment?: string; category?: FeedbackCategory; status?: string | null }>("/api/feedback", "POST", input);

export const undoFeedback = (id: string) => send<{ id: string }>(`/api/feedback/${id}`, "DELETE");

export const reviewFeedback = (action: "keep" | "ignore", ids: string[]) =>
  send<{ count: number }>("/api/feedback/review", "POST", { action, ids });

export const setComplaintStatus = (id: string, status: ComplaintStatus) =>
  send<{ id: string }>(`/api/feedback/${id}`, "PATCH", { status });
