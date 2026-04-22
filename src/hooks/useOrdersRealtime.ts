"use client";

import { useEffect, useRef, useState } from "react";
import type { SWRInfiniteKeyedMutator } from "swr/infinite";
import { createClient } from "@/lib/supabase/client";
import type { OrdersListPage, OrdersListRow } from "@/hooks/useOrdersList";

export interface NewRowBuffer {
  rows: OrdersListRow[];
}

interface UseOrdersRealtimeOptions {
  marketId: string | null;
  /** SWR mutate from useOrdersList for in-place UPDATE/DELETE reconciliation. */
  mutate: SWRInfiniteKeyedMutator<OrdersListPage[]>;
  /** When true (e.g. filters allow `status=new`), match-accept incoming rows. */
  matchFilter: (row: OrdersListRow) => boolean;
}

/**
 * Subscribe to `orders` postgres_changes and reconcile the infinite SWR cache.
 *
 * - INSERT matching current filters → buffered; UI surfaces a "N new · reveal"
 *   banner so the user's scroll isn't yanked.
 * - UPDATE → patched in place if the row is in cache; removed if it no longer
 *   matches filters.
 * - DELETE → removed if present.
 */
export function useOrdersRealtime({
  marketId,
  mutate,
  matchFilter,
}: UseOrdersRealtimeOptions) {
  const [buffer, setBuffer] = useState<OrdersListRow[]>([]);
  // Ref keeps latest matchFilter without recreating the subscription on every filter change
  const matchFilterRef = useRef(matchFilter);
  useEffect(() => { matchFilterRef.current = matchFilter; }, [matchFilter]);

  useEffect(() => {
    const supabase = createClient();
    const channelName = marketId
      ? `orders:market:${marketId}`
      : `orders:all`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          ...(marketId ? { filter: `market_id=eq.${marketId}` } : {}),
        },
        (payload) => {
          const eventType = payload.eventType;
          if (eventType === "INSERT") {
            const row = payload.new as OrdersListRow;
            if (matchFilterRef.current(row)) {
              setBuffer((b) => (b.some((r) => r.id === row.id) ? b : [row, ...b]));
            }
            return;
          }
          if (eventType === "UPDATE") {
            const row = payload.new as OrdersListRow;
            mutate(
              (pages) => {
                if (!pages) return pages;
                const keeps = matchFilterRef.current(row);
                return pages.map((p) => ({
                  ...p,
                  rows: keeps
                    ? p.rows.map((r) => (r.id === row.id ? row : r))
                    : p.rows.filter((r) => r.id !== row.id),
                }));
              },
              { revalidate: false },
            );
            setBuffer((b) =>
              b.map((r) => (r.id === row.id ? row : r)).filter((r) => matchFilterRef.current(r)),
            );
            return;
          }
          if (eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            mutate(
              (pages) => {
                if (!pages) return pages;
                return pages.map((p) => ({
                  ...p,
                  rows: p.rows.filter((r) => r.id !== oldRow.id),
                }));
              },
              { revalidate: false },
            );
            setBuffer((b) => b.filter((r) => r.id !== oldRow.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId, mutate]);

  const reveal = () => {
    if (buffer.length === 0) return;
    const newRows = buffer;
    mutate(
      (pages) => {
        if (!pages || pages.length === 0) {
          return [{ rows: newRows, nextCursor: null }];
        }
        const [first, ...rest] = pages;
        const existingIds = new Set(first.rows.map((r) => r.id));
        const unique = newRows.filter((r) => !existingIds.has(r.id));
        return [{ ...first, rows: [...unique, ...first.rows] }, ...rest];
      },
      { revalidate: false },
    );
    setBuffer([]);
  };

  const dismiss = () => setBuffer([]);

  return { newRows: buffer, newCount: buffer.length, reveal, dismiss };
}
