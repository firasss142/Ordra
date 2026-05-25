import useSWR from "swr";
import type { DexpressStatusSnapshot } from "@/lib/carriers/dexpress/tracking";

/**
 * Reads the current Dexpress carrier-side status for an order.
 *
 * Gated on `enabled` (callers pass `carrier.code === "dexpress" && tracking_number`).
 * When `enabled` is false or `orderId` is empty, no network call fires.
 *
 * Custom fetcher: Dexpress-side "not found" is a *successful* result from the
 * UI's POV (we render a distinct message + hide retry). The default SWR fetcher
 * would treat the 404 as an error and lose the discriminator. So this fetcher
 * checks for `kind === "not_found"` before deciding whether to throw.
 */
async function fetcher(url: string): Promise<DexpressStatusSnapshot> {
  const response = await fetch(url);
  const body = (await response.json().catch(() => null)) as unknown;

  if (response.ok) {
    return body as DexpressStatusSnapshot;
  }

  // 404 with our discriminator means Dexpress doesn't recognize the tracking
  // number — propagate as a snapshot, not an error.
  if (
    response.status === 404 &&
    body &&
    typeof body === "object" &&
    "kind" in (body as Record<string, unknown>) &&
    (body as Record<string, unknown>).kind === "not_found"
  ) {
    return body as DexpressStatusSnapshot;
  }

  // Everything else is a real error.
  const message =
    body && typeof body === "object" && "error" in (body as Record<string, unknown>)
      ? String((body as Record<string, unknown>).error)
      : `HTTP ${response.status}`;
  throw new Error(message);
}

export interface UseDexpressStatusResult {
  snapshot: DexpressStatusSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<DexpressStatusSnapshot | undefined>;
}

export function useDexpressStatus(
  orderId: string,
  enabled: boolean,
): UseDexpressStatusResult {
  const key =
    enabled && orderId ? `/api/orders/${orderId}/dexpress-status` : null;

  const { data, error, isLoading, mutate } = useSWR<DexpressStatusSnapshot>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
      shouldRetryOnError: false,
    },
  );

  return {
    snapshot: data ?? null,
    isLoading: Boolean(isLoading),
    error: error ?? null,
    refresh: () => mutate(),
  };
}
