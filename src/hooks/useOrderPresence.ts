"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCK_HEARTBEAT_MS } from "@/lib/orders/order-lock";

export interface BlockingAgent {
  user_id: string;
  full_name: string | null;
  opened_at: string | null;
  expires_at: string | null;
}

interface Options {
  /** The order whose detail view is open, or null when none is. */
  orderId: string | null;
  /** The viewer's role. Only `agent` rows block anything; managers are advisory. */
  role: string | undefined;
  /** "viewing" until the viewer actually starts changing something. */
  mode?: "viewing" | "editing";
  /** A heartbeat found no live row: expired, or a super_admin forced it. */
  onLockLost?: () => void;
}

/**
 * Announces that this tab has an order open, and keeps saying so.
 *
 * One row per open panel per TAB. The session id is generated once per mount
 * and reused, so an agent with the same order in two tabs does not lose the
 * surviving tab's row when the first one closes.
 *
 * The heartbeat STOPS while the tab is hidden. The alternative — beating in the
 * background — means a tab left open overnight holds a lock that a
 * market_manager has no way to break, and browsers throttle background timers
 * to roughly once a minute anyway. Coming back re-ACQUIRES rather than beats:
 * that is idempotent if nobody took the order, and reports the new holder if
 * somebody did.
 */
export function useOrderPresence({ orderId, role, mode = "viewing", onLockLost }: Options) {
  const [blockingAgent, setBlockingAgent] = useState<BlockingAgent | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const onLockLostRef = useRef(onLockLost);
  onLockLostRef.current = onLockLost;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const post = useCallback(
    async (action: "acquire" | "heartbeat" | "release", id: string) => {
      const res = await fetch(`/api/orders/${id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          session_id: sessionIdRef.current,
          mode: modeRef.current,
        }),
      });

      if (res.status === 409) {
        // Only a heartbeat answers lock_lost, and only when the row is gone.
        onLockLostRef.current?.();
        return null;
      }
      if (!res.ok) return null;
      if (res.status === 204) return null;

      const body = (await res.json()) as { data?: { blocking_agent?: BlockingAgent | null } };
      return body.data ?? null;
    },
    [],
  );

  useEffect(() => {
    if (!orderId || !role) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopBeating = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startBeating = () => {
      stopBeating();
      timer = setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void post("heartbeat", orderId);
      }, LOCK_HEARTBEAT_MS);
    };

    const acquire = async () => {
      const data = await post("acquire", orderId);
      if (cancelled || !data) return;
      setBlockingAgent(data.blocking_agent ?? null);
    };

    void acquire();
    startBeating();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopBeating();
        return;
      }
      // Re-acquire, not beat: the row may already have expired while away.
      void acquire();
      startBeating();
    };

    // `pagehide`, not `beforeunload`: beforeunload does not fire on mobile or
    // when the page enters the bfcache. sendBeacon needs a typed Blob or the
    // request arrives as text/plain.
    const onPageHide = () => {
      const payload = JSON.stringify({
        action: "release",
        session_id: sessionIdRef.current,
      });
      navigator.sendBeacon?.(
        `/api/orders/${orderId}/presence`,
        new Blob([payload], { type: "application/json" }),
      );
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      stopBeating();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // The page is still alive here, so a normal fetch is fine and more
      // reliable than a beacon. Expiry is the backstop either way.
      void post("release", orderId);
      setBlockingAgent(null);
    };
  }, [orderId, role, post]);

  return { blockingAgent, sessionId: sessionIdRef.current };
}
