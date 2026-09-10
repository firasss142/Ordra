"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRealtimeBroadcast } from "@/components/providers/RealtimeProvider";

export interface PresenceRow {
  order_id: string;
  user_id: string;
  role: "agent" | "market_manager" | "super_admin";
  mode: "viewing" | "editing";
  opened_at: string;
  expires_at: string;
}

interface PresencePayload extends PresenceRow {
  op: "INSERT" | "UPDATE" | "DELETE";
}

/** Topic must NOT start with `orders:market:` — agents may join that one. */
export function presenceMarketTopic(marketId: string): string {
  return `order_presence:market:${marketId}`;
}

export const PRESENCE_EVENT = "presence_changed";

/** How often liveness is re-evaluated locally. See the note on the tick below. */
const TICK_MS = 10_000;

/**
 * Who has which order open, for the manager's list.
 *
 * A separate, tiny SWR key rather than a join into /api/orders/list — and not
 * merely for cost. useOrdersList sets revalidateFirstPage:false and
 * refreshInterval:0 while realtime is connected, and taking a lock changes no
 * order row, so no `order_changed` broadcast fires. A lock joined into the list
 * would go stale and stay stale.
 *
 * Rows live in a REF, not in state. A heartbeat only moves `expires_at`, and
 * putting that in state would repaint every row of the orders table every 25
 * seconds. State holds a signature of `orderId:userId:mode` triples instead, so
 * a re-render happens only when the set of people actually changes.
 */
export function useOrderLocks({
  marketId,
  enabled,
}: {
  marketId: string | null;
  enabled: boolean;
}) {
  const rowsRef = useRef<Map<string, PresenceRow>>(new Map());
  const skewMsRef = useRef(0);
  const [signature, setSignature] = useState("");
  const [, forceTick] = useState(0);

  const key = enabled && marketId ? "/api/orders/presence" : null;

  const { mutate } = useSWR(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) return { data: [] as PresenceRow[], server_now: null };
      return (await res.json()) as { data: PresenceRow[]; server_now: string | null };
    },
    {
      // Realtime carries the changes; this is the catch-up path only.
      refreshInterval: 0,
      revalidateOnFocus: true,
      dedupingInterval: 2000,
      onSuccess: (payload) => {
        if (payload?.server_now) {
          // A laptop clock two minutes out would otherwise read every live lock
          // as expired, or every dead one as live.
          skewMsRef.current = new Date(payload.server_now).getTime() - Date.now();
        }
        rowsRef.current = new Map((payload?.data ?? []).map((r) => [rowKey(r), r]));
        publish();
      },
    },
  );

  const publish = useCallback(() => {
    setSignature(signatureOf(rowsRef.current, Date.now() + skewMsRef.current));
  }, []);

  useRealtimeBroadcast<PresencePayload>(
    enabled && marketId ? { topic: presenceMarketTopic(marketId), event: PRESENCE_EVENT } : null,
    (payload) => {
      if (!payload?.order_id) return;
      const k = rowKey(payload);
      if (payload.op === "DELETE") rowsRef.current.delete(k);
      else rowsRef.current.set(k, payload);
      // A pure heartbeat leaves the signature identical, so this is a no-op
      // re-render-wise — which is the point.
      publish();
    },
  );

  // Expiry emits no database event, so only a local tick can retire a stale
  // row. 10s rather than 60s: with a 75s TTL, a minute-long tick could show a
  // lock as held for a further minute after it died, and an indicator that
  // lies is worse than none. The timer does not run when there is nothing live.
  useEffect(() => {
    if (!enabled || rowsRef.current.size === 0) return;
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      forceTick((n) => n + 1);
      publish();
    }, TICK_MS);
    return () => clearInterval(t);
  }, [enabled, signature, publish]);

  const live = useMemo(() => {
    const now = Date.now() + skewMsRef.current;
    const byOrder = new Map<string, PresenceRow[]>();
    for (const row of rowsRef.current.values()) {
      if (new Date(row.expires_at).getTime() <= now) continue;
      const list = byOrder.get(row.order_id) ?? [];
      list.push(row);
      byOrder.set(row.order_id, list);
    }
    return byOrder;
    // `signature` is the dependency on purpose: it changes exactly when the
    // live set does, and the tick bumps it.
  }, [signature]);

  /** The blocking agent on this order, if any. Managers never block. */
  const lockOf = useCallback(
    (orderId: string): PresenceRow | null =>
      live.get(orderId)?.find((r) => r.role === "agent") ?? null,
    [live],
  );

  /** Everyone present on this order, agents and managers alike. */
  const presenceOf = useCallback(
    (orderId: string): PresenceRow[] => live.get(orderId) ?? [],
    [live],
  );

  return { lockOf, presenceOf, refresh: mutate };
}

function rowKey(r: { order_id: string; user_id: string }) {
  return `${r.order_id}:${r.user_id}`;
}

function signatureOf(rows: Map<string, PresenceRow>, now: number) {
  const parts: string[] = [];
  for (const r of rows.values()) {
    if (new Date(r.expires_at).getTime() <= now) continue;
    parts.push(`${r.order_id}:${r.user_id}:${r.role}:${r.mode}`);
  }
  return parts.sort().join("|");
}
