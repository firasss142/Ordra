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

  /**
   * The mode this tab has actually told the server about, or null while no row
   * is known to exist. Not state: it must never trigger a render, and it is
   * read inside effects that must not re-run when it moves.
   */
  const publishedModeRef = useRef<"viewing" | "editing" | null>(null);

  /**
   * Bumped whenever the row this tab owns is abandoned (release, unmount, lock
   * lost). A response carrying a stale generation may still be read for its
   * body, but must never write `publishedModeRef` — otherwise a release
   * resolving after a re-acquire nulls the ref and mode pushes die silently for
   * the rest of the mount.
   */
  const generationRef = useRef(0);

  const post = useCallback(
    async (action: "acquire" | "heartbeat" | "release", id: string) => {
      const sent = modeRef.current;
      const generation = generationRef.current;
      const res = await fetch(`/api/orders/${id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          session_id: sessionIdRef.current,
          mode: sent,
        }),
      });

      const current = () => generationRef.current === generation;

      if (res.status === 409) {
        // Only a heartbeat answers lock_lost, and only when the row is gone.
        if (current()) {
          generationRef.current += 1;
          publishedModeRef.current = null;
        }
        onLockLostRef.current?.();
        return null;
      }
      if (!res.ok) return null;

      // A release owns no mode, and its late resolution must not speak for the
      // acquire that replaced it.
      if (res.status === 204 || action === "release") return null;

      const body = (await res.json()) as {
        data?: { tracked?: boolean; blocking_agent?: BlockingAgent | null };
      };
      const data = body.data ?? null;

      // `acquire` answers 200 `{tracked:false}` WITHOUT creating a row — an
      // agent on an order they no longer own, or past its lockable statuses.
      // Recording a mode there would let the next keystroke heartbeat a row
      // that does not exist, drawing a 409 and throwing the agent onto the
      // takeover screen when nothing was ever taken.
      if (action === "acquire" && data?.tracked === false) {
        if (current()) publishedModeRef.current = null;
        return data;
      }

      // Record what the server believes only once it has agreed to it, so a
      // dropped request is retried by the next transition rather than swallowed.
      if (current()) publishedModeRef.current = sent;

      return data;
    },
    [],
  );

  /**
   * Push the current mode, if the server does not already have it.
   *
   * Returns without posting while `publishedModeRef` is null — there is no row
   * to update until the acquire lands, and a heartbeat against a row that does
   * not exist answers `409 lock_lost`, which would throw an agent onto the
   * takeover screen for the crime of typing quickly.
   */
  const syncMode = useCallback(
    (id: string) => {
      if (publishedModeRef.current === null) return;
      if (publishedModeRef.current === modeRef.current) return;
      void post("heartbeat", id);
    },
    [post],
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
        // No row to keep alive: an untracked acquire (an order this agent no
        // longer owns, or past its lockable statuses) creates none. Beating one
        // draws a 409 and a takeover screen for an order nobody took.
        if (publishedModeRef.current === null) return;
        void post("heartbeat", orderId);
      }, LOCK_HEARTBEAT_MS);
    };

    const acquire = async () => {
      const data = await post("acquire", orderId);
      if (cancelled) return;
      if (data) setBlockingAgent(data.blocking_agent ?? null);
      // The viewer may have started typing during the round-trip; that
      // transition was held back because there was no row to update yet.
      syncMode(orderId);
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
      generationRef.current += 1;
      publishedModeRef.current = null;
      setBlockingAgent(null);
    };
  }, [orderId, role, post, syncMode]);

  /**
   * Announce a mode change the moment it happens.
   *
   * `mode` used to ride the 25s heartbeat, while a typing burst only lasts
   * TYPING_IDLE_MS (4s) — so the bubble had roughly a 4-in-25 chance of being
   * sampled at all, and up to 25s of lag when it was. That is exactly the
   * "very delayed, and sometimes it never shows" report.
   *
   * The rate is bounded by construction rather than by a throttle, which is why
   * there is none: `mode` can only rise to "editing" once per burst, and can
   * only fall back after 4s of continuous idle. Two small upserts per burst,
   * against a table holding tens of rows.
   */
  useEffect(() => {
    if (!orderId || !role) return;
    syncMode(orderId);
  }, [orderId, role, mode, syncMode]);

  return { blockingAgent, sessionId: sessionIdRef.current };
}
