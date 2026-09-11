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
  /** Embedded by GET /api/orders/presence — see the note there. */
  full_name?: string | null;
  avatar_url?: string | null;
}

/**
 * What the broadcast trigger actually sends — deliberately WITHOUT identity.
 *
 * `extends PresenceRow` used to make this type-check while being false at
 * runtime: full_name/avatar_url are optional on PresenceRow, so TypeScript
 * believed the payload carried them. It never has. Only list_order_presence
 * (the SECURITY DEFINER reader) can cross the `users` RLS boundary.
 */
type PresencePayload = Omit<PresenceRow, "full_name" | "avatar_url"> & {
  op: "INSERT" | "UPDATE" | "DELETE";
};

/** Topic must NOT start with `orders:market:` — agents may join that one. */
export function presenceMarketTopic(marketId: string): string {
  return `order_presence:market:${marketId}`;
}

/**
 * An agent's own topic. Exact-match in the realtime.messages policy, so an
 * agent can only ever join theirs and never sees another agent's traffic.
 */
export function presenceAgentTopic(userId: string): string {
  return `order_presence:agent:${userId}`;
}

/**
 * Which slice of presence this viewer is entitled to.
 *   market → super_admin / market_manager: everyone in the market.
 *   agent  → that agent: their own rows plus anyone standing on their orders.
 */
export type PresenceScope =
  | { kind: "market" }
  | { kind: "agent"; userId: string };

export const PRESENCE_EVENT = "presence_changed";

/** How often liveness is re-evaluated locally. See the note on the tick below. */
const TICK_MS = 10_000;

/** One shared instance, so an unlocked row keeps a stable prop identity. */
const NO_PRESENCE: PresenceRow[] = [];

/**
 * A burst of arrivals costs ONE identity fetch, not one each — the same
 * coalescing window useOrdersRealtime uses for the orders list.
 */
const IDENTITY_COALESCE_MS = 300;

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
  scope = { kind: "market" },
  selfId,
}: {
  marketId: string | null;
  enabled: boolean;
  scope?: PresenceScope;
  /** The viewer, so `othersOn` can leave them out of their own indicator. */
  selfId?: string | null;
}) {
  const rowsRef = useRef<Map<string, PresenceRow>>(new Map());
  const skewMsRef = useRef(0);
  const [signature, setSignature] = useState("");
  const [, forceTick] = useState(0);

  const topic =
    scope.kind === "agent"
      ? presenceAgentTopic(scope.userId)
      : marketId
        ? presenceMarketTopic(marketId)
        : null;

  // An agent's rows come from RLS, not from a market id, so they do not need
  // one to subscribe.
  const key = enabled && (scope.kind === "agent" || marketId) ? "/api/orders/presence" : null;

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

  const identityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleIdentityRefetch = useCallback(() => {
    if (identityTimerRef.current !== null) return;
    identityTimerRef.current = setTimeout(() => {
      identityTimerRef.current = null;
      void mutate();
    }, IDENTITY_COALESCE_MS);
  }, [mutate]);

  useEffect(
    () => () => {
      if (identityTimerRef.current !== null) clearTimeout(identityTimerRef.current);
    },
    [],
  );

  const publish = useCallback(() => {
    setSignature(signatureOf(rowsRef.current, Date.now() + skewMsRef.current));
  }, []);

  useRealtimeBroadcast<PresencePayload>(
    enabled && topic ? { topic, event: PRESENCE_EVENT } : null,
    (payload) => {
      if (!payload?.order_id) return;
      const k = rowKey(payload);

      if (payload.op === "DELETE") {
        rowsRef.current.delete(k);
        publish();
        return;
      }

      // MERGE, never replace. The payload has no name or photo, so overwriting
      // the row wholesale dropped the identity the HTTP reader had supplied —
      // and the head flickered to "??" within one 25s heartbeat of appearing.
      const prev = rowsRef.current.get(k);
      rowsRef.current.set(k, {
        ...payload,
        full_name: prev?.full_name ?? null,
        avatar_url: prev?.avatar_url ?? null,
      });

      // A row we have never seen over HTTP has no identity at all. Fetch it
      // rather than drawing an anonymous head.
      if (!prev) scheduleIdentityRefetch();

      // A pure heartbeat leaves the signature identical, so this is a no-op
      // re-render-wise — which is the point.
      publish();
    },
  );

  // Expiry emits no database event, so only a local tick can retire a stale
  // row. 10s rather than 60s: with a 75s TTL, a minute-long tick could show a
  // lock as held for a further minute after it died, and an indicator that
  // lies is worse than none. The timer does not run when there is nothing live.
  // Gated on STATE, not on rowsRef. A ref is not a dependency, so the old guard
  // (`rowsRef.current.size === 0`) made the timer's existence depend on arrival
  // order: it bailed on first paint and only ever restarted by luck when
  // `signature` happened to change. It also never stopped, because an expired
  // row stays in the map.
  const hasLive = signature.length > 0;
  useEffect(() => {
    if (!enabled || !hasLive) return;
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      forceTick((n) => n + 1);
      publish();
    }, TICK_MS);
    return () => clearInterval(t);
  }, [enabled, hasLive, publish]);

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

  /**
   * Everyone present on this order, agents and managers alike.
   *
   * Returns a SHARED empty array for the common case. `?? []` would mint a new
   * array on every call, which would defeat OrderRow's memo comparator for
   * every unlocked row in the table — i.e. almost all of them.
   */
  const presenceOf = useCallback(
    (orderId: string): PresenceRow[] => live.get(orderId) ?? NO_PRESENCE,
    [live],
  );

  /**
   * Everyone present on this order EXCEPT the viewer.
   *
   * Seeing your own head on a row you just closed reads as "someone else is in
   * here" for as long as the row survives — up to a full TTL. The acquire RPC
   * and the broadcast trigger both drop self already; the list endpoint was the
   * one place that convention went missing.
   */
  const othersOn = useCallback(
    (orderId: string): PresenceRow[] => {
      const rows = live.get(orderId);
      if (!rows) return NO_PRESENCE;
      const others = selfId ? rows.filter((r) => r.user_id !== selfId) : rows;
      return others.length === 0 ? NO_PRESENCE : others;
    },
    [live, selfId],
  );

  return { lockOf, presenceOf, othersOn, refresh: mutate };
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
