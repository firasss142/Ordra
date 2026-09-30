"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import type { ThreadConversation } from "@/lib/whatsapp/thread";

export interface InboxConversation extends ThreadConversation {
  market_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

/** The inbox list, kept live on any conversation change in the market. */
export function useOrphanConversations(marketId: string | null, scope: "orphans" | "all") {
  const key = marketId ? `/api/whatsapp/conversations?market_id=${marketId}&scope=${scope}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: InboxConversation[]; counts?: { orphans: number; all: number } }>(key, fetcher, {
    revalidateOnFocus: true,
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const onEvent = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void mutateRef.current(), 250);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useRealtimeSubscribe(marketId ? { table: "whatsapp_conversations", marketId } : null, onEvent);

  // Both tabs' sizes, whichever tab is open (« À rattacher 3 · Toutes 27 »).
  return { conversations: data?.data ?? [], counts: data?.counts ?? null, error, isLoading, mutate };
}

/**
 * The sidebar badge. Polled like the unassigned-orders count (the Sidebar
 * mounts outside the realtime provider in tests, and a minute's lag on a
 * badge is fine).
 */
export function useOrphanUnreadCount(marketId: string | null, enabled: boolean) {
  const { data } = useSWR<{ count: number }>(enabled ? `/api/whatsapp/conversations/unread-count${marketId ? `?market_id=${marketId}` : ""}` : null, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });
  return data?.count ?? 0;
}
