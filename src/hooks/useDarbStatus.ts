import useSWR from "swr";
import type { DarbTimelineEvent } from "@/lib/carriers/darb-assabil-tracking";

/**
 * Reads the live Darb Assabil shipment timeline for an order (detail panel).
 *
 * Gated on `enabled` (callers pass `carrier.code === "darb_assabil" &&
 * tracking_number`). When disabled or orderId is empty, no network call fires.
 *
 * Unlike the Dexpress hook (which renders a lifecycle pipeline from a single
 * status snapshot), Darb returns an append-only event list straight from the
 * carrier API, so this hook just surfaces those events for chronological
 * display.
 */

export interface DarbStatusResponse {
  kind: "ok";
  trackingNumber: string;
  timeline: DarbTimelineEvent[];
}

async function fetcher(url: string): Promise<DarbStatusResponse> {
  const response = await fetch(url);
  const body = (await response.json().catch(() => null)) as unknown;

  if (response.ok) {
    return body as DarbStatusResponse;
  }

  const message =
    body && typeof body === "object" && "error" in (body as Record<string, unknown>)
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${response.status}`;
  throw new Error(message);
}

export interface UseDarbStatusResult {
  timeline: DarbTimelineEvent[] | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<DarbStatusResponse | undefined>;
}

export function useDarbStatus(
  orderId: string,
  enabled: boolean,
): UseDarbStatusResult {
  const key = enabled && orderId ? `/api/orders/${orderId}/darb-status` : null;

  const { data, error, isLoading, mutate } = useSWR<DarbStatusResponse>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      shouldRetryOnError: false,
    },
  );

  return {
    timeline: data?.timeline ?? null,
    isLoading: Boolean(isLoading),
    error: error ?? null,
    refresh: () => mutate(),
  };
}
