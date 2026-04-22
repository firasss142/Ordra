"use client";

import { useEffect, useCallback } from "react";
import useSWR from "swr";
import { createClient } from "@/lib/supabase/client";

export interface AgentNotification {
  id: string;
  order_id: string;
  kind: "callback_due" | "attempt_due";
  due_at: string;
  read_at: string | null;
  created_at: string;
}

export function useAgentNotifications(agentId: string | undefined) {
  const { data, mutate } = useSWR(
    agentId ? "/api/notifications" : null,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  const notifications: AgentNotification[] = data?.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!agentId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`agent-notifications:${agentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_notifications",
          filter: `agent_id=eq.${agentId}`,
        },
        () => {
          mutate();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agentId, mutate]);

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
