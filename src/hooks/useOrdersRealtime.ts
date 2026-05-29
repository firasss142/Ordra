"use client";

import { useCallback, useRef } from "react";
import type { SWRInfiniteKeyedMutator } from "swr/infinite";
import { useRealtimeSubscribe, useRealtime } from "@/components/providers/RealtimeProvider";
import { useRealtimeToast, type RealtimeTerminalKind } from "@/lib/realtime/toast";
import type { OrdersListPage, OrdersListRow } from "@/hooks/useOrdersList";

interface UseOrdersRealtimeOptions {
  marketId: string | null;
  /** SWR mutate from useOrdersList for in-place INSERT/UPDATE/DELETE reconciliation. */
  mutate: SWRInfiniteKeyedMutator<OrdersListPage[]>;
  /** When true (e.g. filters allow `status=new`), match-accept incoming rows. */
  matchFilter: (row: OrdersListRow) => boolean;
}

const TERMINAL_STATUS_TO_KIND: Record<string, RealtimeTerminalKind> = {
  cancelled: "cancelled",
  rejected: "rejected",
  delivered: "delivered",
  returned: "returned",
  deleted: "deleted",
};

/**
 * Subscribe to `orders` realtime via the shared bus and auto-patch the
 * infinite SWR cache:
 *  - INSERT matching current filters → prepend to page 1.
 *  - UPDATE → patch in place; if the row no longer matches filters, remove it
 *    and (for terminal status transitions) fire a toast.
 *  - DELETE → remove and fire the `deleted` toast.
 *
 * Locked rows (open edit form) are intentionally skipped to avoid clobbering
 * the user's draft input.
 */
export function useOrdersRealtime({
  marketId,
  mutate,
  matchFilter,
}: UseOrdersRealtimeOptions) {
  const matchFilterRef = useRef(matchFilter);
  matchFilterRef.current = matchFilter;

  const { editLock } = useRealtime();
  const toastTerminal = useRealtimeToast();
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const handler = useCallback((payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE";
    new?: OrdersListRow;
    old?: Partial<OrdersListRow> & { id?: string };
  }) => {
    const fnMutate = mutateRef.current;

    if (payload.eventType === "INSERT") {
      const row = payload.new;
      if (!row) return;
      if (!matchFilterRef.current(row)) return;
      // Auto-prepend to page 1, dedupe by id.
      fnMutate(
        (pages) => {
          if (!pages || pages.length === 0) {
            return [{ rows: [row], nextCursor: null }];
          }
          const [first, ...rest] = pages;
          if (first.rows.some((r) => r.id === row.id)) return pages;
          return [{ ...first, rows: [row, ...first.rows] }, ...rest];
        },
        { revalidate: false },
      );
      return;
    }

    if (payload.eventType === "UPDATE") {
      const row = payload.new;
      if (!row) return;
      // Don't clobber a row the user is editing.
      if (editLock.isLocked("orders", row.id)) return;

      const keeps = matchFilterRef.current(row);
      const oldStatus = payload.old?.status;
      const becameTerminal =
        !keeps &&
        oldStatus !== row.status &&
        row.status in TERMINAL_STATUS_TO_KIND;

      fnMutate(
        (pages) => {
          if (!pages) return pages;
          return pages.map((p) => ({
            ...p,
            rows: keeps
              ? p.rows.map((r) => (r.id === row.id ? row : r))
              : p.rows.filter((r) => r.id !== row.id),
          }));
        },
        { revalidate: false },
      );

      if (becameTerminal) {
        toastTerminal(row, TERMINAL_STATUS_TO_KIND[row.status]);
      }
      return;
    }

    if (payload.eventType === "DELETE") {
      const oldRow = payload.old;
      if (!oldRow?.id) return;
      if (editLock.isLocked("orders", oldRow.id)) return;

      let removed: OrdersListRow | null = null;
      fnMutate(
        (pages) => {
          if (!pages) return pages;
          return pages.map((p) => ({
            ...p,
            rows: p.rows.filter((r) => {
              if (r.id === oldRow.id) {
                removed = r;
                return false;
              }
              return true;
            }),
          }));
        },
        { revalidate: false },
      );
      if (removed) {
        toastTerminal(removed, "deleted");
      }
    }
  }, [editLock, toastTerminal]);

  useRealtimeSubscribe<OrdersListRow>({ table: "orders", marketId }, handler);
}
