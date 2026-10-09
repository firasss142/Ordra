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

export interface VoiceQuery {
  from: string | null;
  to: string | null;
  family: string | null;
  agent: string | null;
}

const qs = (o: Record<string, string | number | null | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export function useFeedbackOverview(q: VoiceQuery, market: string | null | undefined, enabled = true) {
  const key = enabled ? withMarket(`/api/feedback/overview?${qs({ ...q })}`, market) : null;
  // Switching a product or the period keeps the numbers on screen while the next ones load —
  // `stale` says they belong to the previous filter, so the page can dim them.
  const { data, error, isLoading, mutate } = useSWR<{ data: FeedbackOverviewResponse }>(key, fetcher, {
    keepPreviousData: true,
  });
  return { overview: data?.data ?? null, error, isLoading, stale: isLoading && Boolean(data), mutate };
}

/** The sheet: every live row of the period (the page groups and filters the views itself). */
export function useFeedbackRows(q: VoiceQuery, market: string | null | undefined, enabled = true) {
  const key = enabled ? withMarket(`/api/feedback/rows?${qs({ ...q })}`, market) : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: FeedbackRowsResponse }>(key, fetcher, { keepPreviousData: true });
  return { rows: data?.data?.rows ?? null, total: data?.data?.total ?? 0, error, isLoading, mutate };
}

/** One row by id, whatever its date — for a drawer opened on a row the sheet has not loaded. */
export function useFeedbackRow(id: string | null, market: string | null | undefined) {
  const key = id ? withMarket(`/api/feedback/rows?id=${encodeURIComponent(id)}`, market) : null;
  const { data, mutate } = useSWR<{ data: FeedbackRowsResponse }>(key, fetcher, FRESH);
  return { row: data?.data?.rows?.[0] ?? null, mutate };
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
  /** « Garder dans Voix du client » from the Messages inbox (managers). */
  source?: "whatsapp";
}

export const createFeedback = (input: CreateFeedbackInput) =>
  send<{ id: string; moment?: string; category?: FeedbackCategory; status?: string | null }>("/api/feedback", "POST", input);

export const undoFeedback = (id: string) => send<{ id: string }>(`/api/feedback/${id}`, "DELETE");

/** « Écarter » · « Annuler » (restore) on one row or many. */
export const discardFeedback = (ids: string[]) => send<{ count: number }>("/api/feedback/bulk", "POST", { action: "discard", ids });
export const restoreFeedback = (ids: string[]) => send<{ count: number }>("/api/feedback/bulk", "POST", { action: "restore", ids });

/** « Changer la raison » — `topicId` null is « Sans raison ». */
export const setFeedbackTopic = (ids: string[], topicId: string | null) =>
  send<{ count: number }>("/api/feedback/bulk", "POST", { action: "topic", ids, topic_id: topicId });

/** « Notre réponse » under a reason; an empty text clears it. */
export const setTopicResponse = (topicId: string, response: string) =>
  send<{ id: string; response: string | null }>(`/api/feedback/topics/${topicId}`, "PATCH", { response });

export const setComplaintStatus = (id: string, status: ComplaintStatus) =>
  send<{ id: string }>(`/api/feedback/${id}`, "PATCH", { status });
