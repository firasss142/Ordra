"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";

export interface AgentNotificationOrder {
  customer_name: string | null;
  product_name: string | null;
  variant_label: string | null;
}

export interface AgentNotification {
  id: string;
  order_id: string;
  kind: "callback_due" | "attempt_due";
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

  const handler = useCallback(() => {
    void mutate();
  }, [mutate]);

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
