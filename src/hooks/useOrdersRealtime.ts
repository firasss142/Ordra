"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSWRConfig } from "swr";
import type { SWRInfiniteKeyedMutator } from "swr/infinite";
import {
  useBroadcastConnected,
  useRealtime,
  useRealtimeBroadcast,
} from "@/components/providers/RealtimeProvider";
import { useRealtimeToast, type RealtimeTerminalKind } from "@/lib/realtime/toast";
import type { OrdersListPage, OrdersListRow } from "@/hooks/useOrdersList";

/** What the `orders_broadcast_change` trigger sends. Slim on purpose. */
export interface OrderChangedPayload {
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  market_id: string;
  status: string;
  assigned_to: string | null;
  archived_at: string | null;
  updated_at: string;
}

interface UseOrdersRealtimeOptions {
  /** Markets to listen to. Super_admin "all markets" passes every market id. */
  marketIds: string[];
  /** SWR mutate from useOrdersList, used to patch rows in place and to revalidate. */
  mutate: SWRInfiniteKeyedMutator<OrdersListPage[]>;
  /** Does a row (after the patch) still belong in the current list? */
  matchFilter: (row: OrdersListRow) => boolean;
}

export const ORDERS_BROADCAST_EVENT = "order_changed";
export function ordersTopic(marketId: string): string {
  return `orders:market:${marketId}`;
}

const TERMINAL_STATUS_TO_KIND: Record<string, RealtimeTerminalKind> = {
  cancelled: "cancelled",
  rejected: "rejected",
  delivered: "delivered",
  returned: "returned",
  deleted: "deleted",
};

/** Keys that describe the same orders as the list and must move with it. */
const COMPANION_KEY_PREFIXES = [
  "/api/orders/status-counts",
  "/api/orders/facet-counts",
  "/api/orders/unassigned/count",
];

/** How long to sit on a burst of events before asking the server once. */
const COALESCE_MS = 300;

/**
 * Keep the Orders list live from the `orders:market:<id>` Broadcast topic.
 *
 * The message is a signal, not the data: the trigger sends only the id and
 * the four fields the list can patch without lying (status, assignee,
 * archive state, updated_at). Everything else — product image, display name,
 * repeat-buyer and duplicate badges — comes from the API, so every burst of
 * events ends in ONE coalesced revalidation of the list and its companion
 * keys (KPI strip, facet counts, sidebar badge). Rows are patched in place
 * first so a status flip is visible immediately; a row that no longer matches
 * the filters is removed; a row under edit is left alone.
 *
 * Replaces the `postgres_changes` subscription, whose per-subscriber RLS
 * evaluation was being cancelled by Postgres in production and which pasted
 * raw WAL rows over enriched ones.
 */
export function useOrdersRealtime({ marketIds, mutate, matchFilter }: UseOrdersRealtimeOptions) {
  const { editLock } = useRealtime();
  const { mutate: globalMutate } = useSWRConfig();
  const toastTerminal = useRealtimeToast();

  const matchFilterRef = useRef(matchFilter);
  matchFilterRef.current = matchFilter;
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revalidateAll = useCallback(() => {
    void mutateRef.current();
    void globalMutate(
      (key) =>
        typeof key === "string" && COMPANION_KEY_PREFIXES.some((p) => key.startsWith(p)),
    );
  }, [globalMutate]);

  const scheduleRevalidate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      revalidateAll();
    }, COALESCE_MS);
  }, [revalidateAll]);

  const handler = useCallback(
    (payload: OrderChangedPayload) => {
      if (!payload || !payload.id) return;
      const locked = editLock.isLocked("orders", payload.id);

      if (payload.op === "DELETE") {
        if (!locked) {
          let removed: OrdersListRow | null = null;
          void mutateRef.current(
            (pages) => {
              if (!pages) return pages;
              return pages.map((p) => ({
                ...p,
                rows: p.rows.filter((r) => {
                  if (r.id === payload.id) {
                    removed = r;
                    return false;
                  }
                  return true;
                }),
              }));
            },
            { revalidate: false },
          );
          if (removed) toastTerminal(removed, "deleted");
        }
        scheduleRevalidate();
        return;
      }

      if (payload.op === "UPDATE" && !locked) {
        let previous: OrdersListRow | null = null;
        let keeps = true;
        void mutateRef.current(
          (pages) => {
            if (!pages) return pages;
            return pages.map((p) => ({
              ...p,
              rows: p.rows.flatMap((r) => {
                if (r.id !== payload.id) return [r];
                previous = r;
                const patched: OrdersListRow = {
                  ...r,
                  status: payload.status,
                  assigned_to: payload.assigned_to,
                  archived_at: payload.archived_at,
                  updated_at: payload.updated_at,
                };
                keeps = payload.archived_at == null && matchFilterRef.current(patched);
                return keeps ? [patched] : [];
              }),
            }));
          },
          { revalidate: false },
        );
        const prev = previous as OrdersListRow | null;
        if (
          prev &&
          !keeps &&
          prev.status !== payload.status &&
          payload.status in TERMINAL_STATUS_TO_KIND
        ) {
          toastTerminal(prev, TERMINAL_STATUS_TO_KIND[payload.status]);
        }
      }

      // INSERT, or an UPDATE on a row we do not have: the API is the only
      // source of the enriched row shape, so ask it (once per burst).
      scheduleRevalidate();
    },
    [editLock, scheduleRevalidate, toastTerminal],
  );

  // One subscription per market. Two markets is the whole catalogue, so the
  // "all markets" scope is two joins rather than a filterless firehose.
  const topics = useMemo(() => marketIds.map(ordersTopic), [marketIds]);
  useRealtimeBroadcast<OrderChangedPayload>(
    topics[0] ? { topic: topics[0], event: ORDERS_BROADCAST_EVENT } : null,
    handler,
  );
  useRealtimeBroadcast<OrderChangedPayload>(
    topics[1] ? { topic: topics[1], event: ORDERS_BROADCAST_EVENT } : null,
    handler,
  );

  const connected = useBroadcastConnected(topics);

  // Catch-up: anything that happened while the socket was down or the tab was
  // hidden is unknown, so the first moment we are live again costs one fetch.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) revalidateAll();
    wasConnectedRef.current = connected;
  }, [connected, revalidateAll]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidateAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [revalidateAll]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { connected };
}
