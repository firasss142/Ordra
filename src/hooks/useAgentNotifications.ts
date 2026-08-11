"use client";

import { useCallback, useEffect, useRef } from "react";
import useSWR from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

/**
 * run_notifications_check inserts a whole tick's worth of notifications in one
 * statement, so a single cron run delivers several realtime events within
 * milliseconds. An explicit mutate() bypasses SWR's dedupingInterval, so
 * without this each event would fire its own /api/notifications request.
 * Matches the debounce idiom in useWarehouseRealtime.
 */
const REFETCH_DEBOUNCE_MS = 250;

export interface AgentNotificationOrder {
  customer_name: string | null;
  product_name: string | null;
  variant_label: string | null;
}

export interface AgentNotification {
  id: string;
  order_id: string;
  kind: "callback_due" | "attempt_due" | "dispatch_due";
  due_at: string;
  read_at: string | null;
  created_at: string;
  order: AgentNotificationOrder | null;
}

export function useAgentNotifications(agentId: string | undefined) {
  // Always fetches unread only. The badge + shake + toast are all driven by
  // unread state; the dropdown's "Show all" toggle pulls history via a separate
  // SWR call so it doesn't churn the badge.
  const { data, mutate } = useSWR(
    agentId ? "/api/notifications" : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  const notifications: AgentNotification[] = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const handler = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      void mutateRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);

  useEffect(
    () => () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    },
    [],
  );

  useRealtimeSubscribe(
    agentId
      ? {
          table: "agent_notifications",
          marketId: null,
          extraFilter: `agent_id=eq.${agentId}`,
        }
      : null,
    handler,
  );

  const markRead = useCallback(
    async (notifId: string) => {
      await fetch(`/api/notifications/${notifId}/read`, { method: "POST" });
      mutate();
    },
    [mutate],
  );

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    mutate();
  }, [mutate]);

  return { notifications, unreadCount, markRead, markAllRead, mutate };
}
