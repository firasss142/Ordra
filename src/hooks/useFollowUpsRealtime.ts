"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SWRInfiniteKeyedMutator } from "swr/infinite";
import type { KeyedMutator } from "swr";
import { useRealtimeSubscribe } from "@/components/providers/RealtimeProvider";
import type { FollowUpsListPage } from "@/lib/follow-ups/list";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";
import {
  FOLLOW_UP_STATUSES,
  type FollowUpStatus,
  type OrderFollowUp,
  type OrderFollowUpWithOrder,
} from "@/types/follow-up";

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
  /** Legacy callback retained for compatibility — fires on each INSERT. */
  onInsert?: (row: BufferedInsert) => void;
  /** Optional timeline (time-first view) mutator — revalidated on any change. */
  timelineMutator?: SWRInfiniteKeyedMutator<FollowUpsListPage[]>;
}

/**
 * Subscribe to `order_follow_ups` realtime via the shared bus and patch the
 * per-status infinite SWR caches. Auto-inserts (no banner): incoming rows
 * prepend immediately to the matching column.
 *
 * Behavior:
 *  - INSERT → prepend to matching column; triggers SWR revalidation so the
 *    enriched (order/campaign join) row replaces the stub.
 *  - UPDATE → if status changed, remove from old column, prepend to new;
 *    else patch in place preserving join fields.
 *  - DELETE → remove from whichever column holds it.
 *
 * Summary KPI strip is refreshed with a 500ms trailing debounce + 3s max-wait
 * to absorb bulk-create bursts from NewCampaignWizard.
 */
export function useFollowUpsRealtime({
  marketId,
  columnMutators,
  mutateSummary,
  onInsert,
  timelineMutator,
}: UseFollowUpsRealtimeOptions) {
  const mutatorsRef = useRef(columnMutators);
  const mutateSummaryRef = useRef(mutateSummary);
  const onInsertRef = useRef(onInsert);
  const timelineMutatorRef = useRef(timelineMutator);
  const summaryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryMaxWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  mutatorsRef.current = columnMutators;
  mutateSummaryRef.current = mutateSummary;
  onInsertRef.current = onInsert;
  timelineMutatorRef.current = timelineMutator;

  const scheduleSummaryRefresh = useCallback(() => {
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
  }, []);

  const handler = useCallback(
    (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new?: RealtimeRow;
      old?: Partial<RealtimeRow>;
    }) => {
      const eventType = payload.eventType;

      if (eventType === "INSERT") {
        const row = payload.new;
        if (!row) return;
        mutatorsRef.current[row.status](
          (pages) => {
            if (!pages || pages.length === 0) {
              return [
                { rows: [row as unknown as OrderFollowUpWithOrder], nextCursor: null },
              ];
            }
            const [first, ...rest] = pages;
            if (first.rows.some((r) => r.id === row.id)) return pages;
            const stub = row as unknown as OrderFollowUpWithOrder;
            return [{ ...first, rows: [stub, ...first.rows] }, ...rest];
          },
          { revalidate: true },
        );
        onInsertRef.current?.({ id: row.id, status: row.status });
        timelineMutatorRef.current?.();
        scheduleSummaryRefresh();
        return;
      }

      if (eventType === "UPDATE") {
        const row = payload.new;
        if (!row) return;
        const oldStatus = payload.old?.status;
        const newStatus = row.status;

        if (oldStatus && oldStatus !== newStatus) {
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

        timelineMutatorRef.current?.();
        scheduleSummaryRefresh();
        return;
      }

      if (eventType === "DELETE") {
        const oldRow = payload.old as (Partial<RealtimeRow> & { id?: string }) | undefined;
        if (!oldRow?.id) return;
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
        timelineMutatorRef.current?.();
        scheduleSummaryRefresh();
      }
    },
    [scheduleSummaryRefresh],
  );

  useRealtimeSubscribe<RealtimeRow>(
    { table: "order_follow_ups", marketId },
    handler,
  );

  useEffect(() => {
    return () => {
      if (summaryDebounceRef.current) clearTimeout(summaryDebounceRef.current);
      if (summaryMaxWaitRef.current) clearTimeout(summaryMaxWaitRef.current);
    };
  }, []);

  // Buffer-banner API kept for backward compatibility; counts always 0 since
  // we auto-prepend on INSERT now.
  const reveal = () => {};
  const dismiss = () => {};

  return { newCount: 0, reveal, dismiss };
}
