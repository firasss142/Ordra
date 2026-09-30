"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { MessageRow } from "@/lib/whatsapp/send";
import { retryRequest } from "@/lib/whatsapp/compose";

export type ThreadTarget = { order_id: string; market_id: string } | { lead_id: string; market_id: string } | null;

const REFETCH_DEBOUNCE_MS = 200;

/**
 * The thread behind an order or a lead, kept live.
 *
 * Realtime delivers each status change of each message (sent → delivered →
 * read arrive within seconds of one another), so the refetch is debounced
 * rather than fired per event. RLS decides which rows reach the subscriber:
 * an agent only hears about messages on their own orders/leads.
 */
export function useWhatsAppThread(target: ThreadTarget) {
  const key = !target ? null : "order_id" in target ? `/api/whatsapp/threads/order/${target.order_id}` : `/api/whatsapp/threads/lead/${target.lead_id}`;
  const { data, error, isLoading, mutate } = useSWR<{ data: ThreadPayload }>(key, fetcher, { revalidateOnFocus: false, keepPreviousData: false });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const onEvent = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void mutateRef.current(), REFETCH_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useRealtimeSubscribe(
    target
      ? {
          table: "whatsapp_messages",
          marketId: target.market_id,
          extraFilter: "order_id" in target ? `order_id=eq.${target.order_id}` : `lead_id=eq.${target.lead_id}`,
        }
      : null,
    onEvent,
  );

  const thread = data?.data ?? null;

  const markRead = useCallback(async () => {
    const id = thread?.conversation?.id;
    if (!id || !thread?.conversation?.unread_count) return;
    await fetch(`/api/whatsapp/conversations/${id}/read`, { method: "POST" }).catch(() => undefined);
    void mutate();
  }, [thread?.conversation?.id, thread?.conversation?.unread_count, mutate]);

  // « Réessayer » on a failed bubble: the same template or text, re-rendered by the server.
  const retry = useCallback(
    async (m: MessageRow) => {
      if (!target) return;
      const sendTarget = "order_id" in target ? { order_id: target.order_id } : { lead_id: target.lead_id };
      const body = retryRequest(sendTarget, m);
      if (!body) return;
      await fetch("/api/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
      void mutate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the target is identified by its key
    [key, mutate],
  );

  return {
    thread,
    unread: thread?.conversation?.unread_count ?? 0,
    retry,
    isLoading,
    error,
    mutate,
    markRead,
  };
}
