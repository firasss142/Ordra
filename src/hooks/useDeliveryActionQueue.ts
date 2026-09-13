"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { applyRecordedAction, type RecordedAction } from "@/lib/delivery/worklist";
import type { WorklistResponse, WorklistRow } from "@/lib/delivery/types";

/**
 * A send flushed on unmount can outlive its SWR cache provider. The server has
 * the action either way, so a refresh that cannot run is not an error.
 */
const ignore = () => {};

/** How long "Annuler" stays possible after an action is recorded. */
export const UNDO_WINDOW_MS = 5_000;

export interface QueuedBody extends RecordedAction {
  template_key?: string | null;
}

export interface PendingAction {
  orderId: string;
  body: QueuedBody;
  /** The row as it was before the action, to put back on undo or failure. */
  before: WorklistRow;
}

/**
 * Records delivery actions with a grace period, so the toast's "Annuler" is
 * real without ever writing a reversal.
 *
 * delivery_actions is append-only (DB trigger). An undo that wrote a second
 * row would leave the ledger saying "called, then un-called", which is worse
 * than useless for the scorecard. So the row moves on screen immediately, but
 * the POST waits for the undo window to close. A second action, leaving the
 * page, or hiding the tab sends whatever is pending at once — with
 * `keepalive`, so it survives the navigation.
 */
export function useDeliveryActionQueue({
  worklistKey,
  onFailed,
  onSent,
}: {
  worklistKey: string | null;
  onFailed?: (error: string) => void;
  onSent?: (orderId: string) => void;
}) {
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const replaceRow = useCallback(
    (orderId: string, next: WorklistRow) => {
      if (!worklistKey) return;
      mutate<WorklistResponse>(
        worklistKey,
        (cur) => (cur ? { ...cur, rows: cur.rows.map((r) => (r.order_id === orderId ? next : r)) } : cur),
        { revalidate: false },
      ).catch(ignore);
    },
    [mutate, worklistKey],
  );

  const send = useCallback(
    async (p: PendingAction) => {
      try {
        const res = await fetch(`/api/delivery/orders/${p.orderId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(p.body),
          keepalive: true,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          replaceRow(p.orderId, p.before);
          onFailedRef.current?.(typeof err?.error === "string" ? err.error : "failed");
        } else {
          onSentRef.current?.(p.orderId);
        }
      } catch {
        replaceRow(p.orderId, p.before);
        onFailedRef.current?.("network");
      } finally {
        if (worklistKey) mutate(worklistKey).catch(ignore);
        mutate((k) => typeof k === "string" && k.startsWith(`/api/delivery/orders/${p.orderId}`)).catch(ignore);
      }
    },
    [mutate, replaceRow, worklistKey],
  );

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pendingRef.current = null;
    setPending(null);
  };

  const flush = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clear();
    void send(p);
  }, [send]);

  const queue = useCallback(
    (row: WorklistRow, body: QueuedBody) => {
      flush();
      const p: PendingAction = { orderId: row.order_id, body, before: row };
      replaceRow(row.order_id, applyRecordedAction(row, body));
      pendingRef.current = p;
      setPending(p);
      timer.current = setTimeout(() => {
        if (pendingRef.current === p) {
          pendingRef.current = null;
          timer.current = null;
          setPending(null);
          void send(p);
        }
      }, UNDO_WINDOW_MS);
    },
    [flush, replaceRow, send],
  );

  const undo = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clear();
    replaceRow(p.orderId, p.before);
  }, [replaceRow]);

  // Never lose an action to a closed tab or a route change.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  return { pending, queue, undo, flush };
}
