"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

export interface WhatsAppAvailability {
  market_id: string;
  connected: boolean;
  active: boolean;
  status: "active" | "paused" | "auth_failed" | null;
  display_phone: string | null;
  verified_name: string | null;
  messaging_limit_tier: string | null;
  quality_rating: string | null;
}

/**
 * Is the business number live for this market? Read once per market and
 * shared by every surface. `known` is false only while the first answer is
 * pending — a failed check counts as known and inactive, because the owner
 * chose "show WhatsApp disabled" over "hide it" for a market that is not
 * connected (2026-09-25), and an error must not bring the hiding back.
 */
export function useWhatsAppAvailability(marketId: string | null) {
  const { data, error, isLoading } = useSWR<{ data: WhatsAppAvailability }>(
    marketId ? `/api/whatsapp/availability?market_id=${marketId}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000, shouldRetryOnError: false },
  );
  return {
    availability: data?.data ?? null,
    active: data?.data?.active ?? false,
    known: Boolean(marketId) && (data !== undefined || error !== undefined),
    isLoading,
  };
}
