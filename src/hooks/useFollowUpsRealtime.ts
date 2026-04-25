"use client";

import { useEffect, useRef, useState } from "react";
import type { SWRInfiniteKeyedMutator } from "swr/infinite";
import type { KeyedMutator } from "swr";
import { createClient } from "@/lib/supabase/client";
import type { FollowUpsListPage } from "@/lib/follow-ups/list";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";
import {
  FOLLOW_UP_STATUSES,
  type FollowUpStatus,
  type OrderFollowUp,
  type OrderFollowUpWithOrder,
} from "@/types/follow-up";

/**
 * Realtime row shape from postgres_changes — the bare order_follow_ups row,
 * WITHOUT the order/campaign joins the list API enriches with. We buffer
 * inserts but rely on the SWR revalidation for the final joined payload.
 */
type RealtimeRow = OrderFollowUp;

export interface BufferedInsert {
  id: string;
  status: FollowUpStatus;
}

interface UseFollowUpsRealtimeOptions {
  marketId: string | null;
  /** Mutators for each column's infinite SWR cache, keyed by status. */
  columnMutators: Record<FollowUpStatus, SWRInfiniteKeyedMutator<FollowUpsListPage[]>>;
  /** Mutator for the summary SWR cache — refreshed on any change. */
  mutateSummary: KeyedMutator<FollowUpsSummary>;
  /** Fires when new inserts arrive so the banner can surface them. */
  onInsert?: (row: BufferedInsert) => void;
  /** Optional timeline (time-first view) mutator — revalidated on any change. */
  timelineMutator?: SWRInfiniteKeyedMutator<FollowUpsListPage[]>;
}

/**
 * Subscribe to `order_follow_ups` postgres_changes and reconcile the per-column
 * infinite SWR caches. Also triggers a debounced summary revalidation so the
 * KPI strip stays fresh without a request per event.
 *
 * - INSERT → buffered; a banner picks it up via `onInsert` / the returned
 *   `buffer`. Revealing prepends to the matching column's cache.
 * - UPDATE → if status changed, removes from the old column and prepends to
 *   the new one; else patches in place.
 * - DELETE → removes from whichever column holds it.
 */
export function useFollowUpsRealtime({
  marketId,
  columnMutators,
  mutateSummary,
  onInsert,
  timelineMutator,
}: UseFollowUpsRealtimeOptions) {
  const [buffer, setBuffer] = useState<RealtimeRow[]>([]);
  const mutatorsRef = useRef(columnMutators);
  const mutateSummaryRef = useRef(mutateSummary);
  const onInsertRef = useRef(onInsert);
  const timelineMutatorRef = useRef(timelineMutator);
  const summaryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryMaxWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mutatorsRef.current = columnMutators;
  }, [columnMutators]);
  useEffect(() => {
    mutateSummaryRef.current = mutateSummary;
  }, [mutateSummary]);
  useEffect(() => {
    onInsertRef.current = onInsert;
  }, [onInsert]);
  useEffect(() => {
    timelineMutatorRef.current = timelineMutator;
  }, [timelineMutator]);

  // Trailing debounce (500ms idle) plus a 3s max-wait — during bulk-create
  // bursts from NewCampaignWizard, summary still refreshes at least every 3s.
  const scheduleSummaryRefresh = () => {
    if (summaryDebounceRef.current) clearTimeout(summaryDebounceRef.current);
    summaryDebounceRef.current = setTimeout(() => {
      if (summaryMaxWaitRef.current) {
        clearTimeout(summaryMaxWaitRef.current);
        summaryMaxWaitRef.current = null;
      }
      mutateSummaryRef.current();
    }, 500);
    if (!summaryMaxWaitRef.current) {
      summaryMaxWaitRef.current = setTimeout(() => {
        if (summaryDebounceRef.current) {
          clearTimeout(summaryDebounceRef.current);
          summaryDebounceRef.current = null;
        }
        summaryMaxWaitRef.current = null;
        mutateSummaryRef.current();
      }, 3000);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    const channelName = marketId ? `follow-ups:market:${marketId}` : `follow-ups:all`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_follow_ups",
          ...(marketId ? { filter: `market_id=eq.${marketId}` } : {}),
        },
        (payload) => {
          const eventType = payload.eventType;

          if (eventType === "INSERT") {
            const row = payload.new as RealtimeRow;
            setBuffer((b) => (b.some((r) => r.id === row.id) ? b : [row, ...b]));
            onInsertRef.current?.({ id: row.id, status: row.status });
            timelineMutatorRef.current?.();
            scheduleSummaryRefresh();
            return;
          }

          if (eventType === "UPDATE") {
            const row = payload.new as RealtimeRow;
            const oldRow = payload.old as RealtimeRow;
            const oldStatus = oldRow?.status;
            const newStatus = row.status;

            if (oldStatus && oldStatus !== newStatus) {
              // Remove from old column.
              mutatorsRef.current[oldStatus](
                (pages) => {
                  if (!pages) return pages;
                  return pages.map((p) => ({
                    ...p,
                    rows: p.rows.filter((r) => r.id !== row.id),
                  }));
                },
                { revalidate: false },
              );
              // Prepend skeleton to new column — SWR will revalidate and fetch
              // the enriched join next cycle.
              mutatorsRef.current[newStatus](
                (pages) => {
                  if (!pages || pages.length === 0) return pages;
                  const [first, ...rest] = pages;
                  if (first.rows.some((r) => r.id === row.id)) return pages;
                  const stub = row as unknown as OrderFollowUpWithOrder;
                  return [{ ...first, rows: [stub, ...first.rows] }, ...rest];
                },
                { revalidate: true },
              );
            } else {
              // Same column — patch in place. Preserve the joined order/campaign
              // fields that the realtime payload doesn't carry.
              mutatorsRef.current[newStatus](
                (pages) => {
                  if (!pages) return pages;
                  return pages.map((p) => ({
                    ...p,
                    rows: p.rows.map((r) =>
                      r.id === row.id ? ({ ...r, ...row } as OrderFollowUpWithOrder) : r,
                    ),
                  }));
                },
                { revalidate: false },
              );
            }

            setBuffer((b) => b.map((r) => (r.id === row.id ? row : r)));
            timelineMutatorRef.current?.();
            scheduleSummaryRefresh();
            return;
          }

          if (eventType === "DELETE") {
            const oldRow = payload.old as { id: string; status?: FollowUpStatus };
            const statuses: readonly FollowUpStatus[] = oldRow.status
              ? [oldRow.status]
              : FOLLOW_UP_STATUSES;

            for (const s of statuses) {
              mutatorsRef.current[s](
                (pages) => {
                  if (!pages) return pages;
                  return pages.map((p) => ({
                    ...p,
                    rows: p.rows.filter((r) => r.id !== oldRow.id),
                  }));
                },
                { revalidate: false },
              );
            }
            setBuffer((b) => b.filter((r) => r.id !== oldRow.id));
            timelineMutatorRef.current?.();
            scheduleSummaryRefresh();
          }
        },
      )
      .subscribe();

    return () => {
      if (summaryDebounceRef.current) clearTimeout(summaryDebounceRef.current);
      if (summaryMaxWaitRef.current) clearTimeout(summaryMaxWaitRef.current);
      supabase.removeChannel(channel);
    };
  }, [marketId]);

  const reveal = () => {
    if (buffer.length === 0) return;
    // Group buffered rows by status and prepend each to its column cache.
    const byStatus = new Map<FollowUpStatus, RealtimeRow[]>();
    for (const row of buffer) {
      const arr = byStatus.get(row.status) ?? [];
      arr.push(row);
      byStatus.set(row.status, arr);
    }

    for (const [status, rows] of byStatus) {
      mutatorsRef.current[status](
        (pages) => {
          if (!pages || pages.length === 0) {
            return [{ rows: rows as unknown as OrderFollowUpWithOrder[], nextCursor: null }];
          }
          const [first, ...rest] = pages;
          const existingIds = new Set(first.rows.map((r) => r.id));
          const unique = (rows as unknown as OrderFollowUpWithOrder[]).filter(
            (r) => !existingIds.has(r.id),
          );
          return [{ ...first, rows: [...unique, ...first.rows] }, ...rest];
        },
        { revalidate: true },
      );
    }
    setBuffer([]);
  };

  const dismiss = () => setBuffer([]);

  return { newCount: buffer.length, reveal, dismiss };
}
