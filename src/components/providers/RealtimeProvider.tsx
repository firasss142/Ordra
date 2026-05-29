"use client";

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  createRealtimeBus,
  type RealtimeBus,
  type RealtimeEvent,
  type RealtimeHandler,
  type SubscribeOptions,
} from "@/lib/realtime/bus";
import {
  createEditLockRegistry,
  type EditLockListener,
  type EditLockRegistry,
} from "@/lib/realtime/edit-lock";

interface RealtimeContextValue {
  bus: RealtimeBus;
  editLock: EditLockRegistry;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Wraps the app with a single per-tab realtime bus + edit-lock registry.
 * Sits inside <SWRProvider> and <MarketScopeProvider>; consumers reach the
 * market id via useMarketScope().
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RealtimeContextValue>(
    () => ({
      bus: createRealtimeBus(),
      editLock: createEditLockRegistry(),
    }),
    [],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error("Realtime hooks must be used inside <RealtimeProvider>");
  }
  return ctx;
}

/**
 * Subscribe to a (table, marketId) channel. Multiple callers for the same
 * (table, marketId, extraFilter) share one underlying channel.
 *
 * The handler is captured in a ref so the subscription is not torn down on
 * every render; only `table`, `marketId`, and `extraFilter` cause resubscribe.
 */
export function useRealtimeSubscribe<TRow = Record<string, unknown>>(
  opts: SubscribeOptions | null,
  handler: RealtimeHandler<TRow>,
): void {
  const { bus } = useRealtimeContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!opts) return;
    const unsub = bus.subscribe<TRow>(opts, (event: RealtimeEvent<TRow>) => {
      handlerRef.current(event);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bus, opts?.table, opts?.marketId ?? null, opts?.extraFilter ?? null]);
}

/**
 * Lock a (table, rowId) while a field is being edited. Returns stable
 * `lock`/`unlock` functions. The lock is automatically released on unmount.
 *
 * Refcounted: multiple fields on the same row can lock independently.
 */
export function useEditLock(table: string, rowId: string | null) {
  const { editLock } = useRealtimeContext();
  const heldRef = useRef(0);

  useEffect(() => {
    return () => {
      // Release any held locks on unmount.
      if (!rowId) return;
      while (heldRef.current > 0) {
        editLock.unlock(table, rowId);
        heldRef.current -= 1;
      }
    };
  }, [editLock, table, rowId]);

  const lock = () => {
    if (!rowId) return;
    editLock.lock(table, rowId);
    heldRef.current += 1;
  };
  const unlock = () => {
    if (!rowId || heldRef.current === 0) return;
    editLock.unlock(table, rowId);
    heldRef.current -= 1;
  };

  return {
    lock,
    unlock,
    isLocked: rowId ? editLock.isLocked(table, rowId) : false,
  };
}

/**
 * Imperative access for non-React or callback-style consumers.
 * Use sparingly — most code should use useRealtimeSubscribe / useEditLock.
 */
export function useRealtime(): RealtimeContextValue {
  return useRealtimeContext();
}

/**
 * Subscribe to lock-release events globally. Used by realtime hooks to know
 * when to flush a queued revalidation after a user finishes editing.
 */
export function useOnEditUnlock(listener: EditLockListener) {
  const { editLock } = useRealtimeContext();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  }, [listener]);
  useEffect(() => editLock.onUnlock((k) => ref.current(k)), [editLock]);
}
