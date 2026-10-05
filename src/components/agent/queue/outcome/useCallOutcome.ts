"use client";

/**
 * The agent's call endings, as requests — the logic PostCallActionSheet carried, out of
 * its 1 400 lines of markup so the panel's tray and the phone sheet share it:
 *
 *   noAnswer   POST /no-answer         (the server auto-rejects at the market's ceiling)
 *   confirm    POST /confirm           (optimistic on the queue cache)
 *   reject     POST /reject            (+ « Voix du client » feedback, only when asked)
 *   callback   POST /callback          (optimistic; never in the past)
 *   dispatch   POST /dispatch          (409 needsConfirmation = the duplicate guard)
 *   schedule   POST /schedule-dispatch (optimistic; never in the past)
 *   deleteDuplicate POST /{twin}/delete-duplicate — « Supprimer celle-ci »
 *
 * Each returns what happened; none of them decides what the screen does next. The
 * error words per HTTP status are the old sheet's.
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useOptimisticOrderAction } from "@/hooks/useOptimisticOrderAction";

export type Busy = "noAnswer" | "confirm" | "reject" | "callback" | "dispatch" | "schedule" | "dup";

export interface NoAnswerResult {
  newStatus: string;
  autoRejected: boolean;
  attemptsCount: number | null;
  callbackAt: string | null;
}

export interface RejectInput {
  group: string;
  sub: string | null;
  note: string | null;
  feedback?: { category: string; topicId: string | null } | null;
}

export type DispatchResult =
  | { kind: "sent"; tracking: string | null }
  | { kind: "duplicate"; externalId: string | null }
  | { kind: "failed" };

const JSON_POST = { method: "POST", headers: { "Content-Type": "application/json" } } as const;

async function readError(res: Response): Promise<string | null> {
  try {
    const j = (await res.clone().json()) as { error?: unknown } | null;
    return j && typeof j.error === "string" ? j.error : null;
  } catch {
    return null;
  }
}

export function useCallOutcome(orderId: string) {
  const t = useTranslations("queue");
  const { run } = useOptimisticOrderAction(orderId);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const httpError = useCallback(
    (status: number): string => {
      if (status === 401) return t("sessionExpired");
      if (status === 403) return t("actionForbidden");
      if (status === 409) return t("statusChanged");
      if (status === 422) return t("carrierRetry");
      return t("networkError");
    },
    [t],
  );

  /** Runs one request with `busy` set and the previous error cleared. */
  const guarded = useCallback(async <R,>(kind: Busy, fn: () => Promise<R>): Promise<R> => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } finally {
      setBusy(null);
    }
  }, []);

  const noAnswer = useCallback(
    () =>
      guarded("noAnswer", async (): Promise<NoAnswerResult | null> => {
        try {
          const res = await fetch(`/api/orders/${orderId}/no-answer`, JSON_POST);
          if (!res.ok) {
            setError(httpError(res.status));
            return null;
          }
          const json = (await res.json()) as { data?: Record<string, unknown> };
          const d = json.data ?? {};
          return {
            newStatus: typeof d.new_status === "string" ? d.new_status : "attempt_1",
            autoRejected: d.auto_rejected === true,
            attemptsCount: typeof d.attempts_count === "number" ? d.attempts_count : null,
            callbackAt: typeof d.callback_at === "string" ? d.callback_at : null,
          };
        } catch {
          setError(t("networkError"));
          return null;
        }
      }),
    [guarded, orderId, httpError, t],
  );

  const confirm = useCallback(
    () =>
      guarded("confirm", async () => {
        let serverError: string | null = null;
        const r = await run({
          optimisticPatch: () => ({ status: "confirmed" }),
          request: async () => {
            const res = await fetch(`/api/orders/${orderId}/confirm`, { ...JSON_POST, body: JSON.stringify({}) });
            if (!res.ok) serverError = await readError(res);
            return res;
          },
        });
        if (!r.ok) setError(serverError ?? httpError(r.status || 500));
        return r.ok;
      }),
    [guarded, run, orderId, httpError],
  );

  const reject = useCallback(
    (i: RejectInput) =>
      guarded("reject", async () => {
        const r = await run({
          optimisticPatch: () => ({
            status: "rejected",
            rejection_reason: i.group,
            rejection_subreason: i.sub,
            rejection_note: i.note,
          }),
          request: () =>
            fetch(`/api/orders/${orderId}/reject`, {
              ...JSON_POST,
              body: JSON.stringify({
                rejection_reason: i.group,
                rejection_subreason: i.sub,
                rejection_note: i.note,
                ...(i.feedback ? { feedback: { category: i.feedback.category, topic_id: i.feedback.topicId } } : {}),
              }),
            }),
        });
        if (!r.ok) {
          // A refused rejection is not a network error: 400 = rechoose, 404 = no longer yours.
          const s = r.status || 500;
          setError(s === 400 ? t("rejectRefused") : s === 404 ? t("realtime.toast.reassignedAway") : httpError(s));
        }
        return r.ok;
      }),
    [guarded, run, orderId, httpError, t],
  );

  const callback = useCallback(
    async (when: Date) => {
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        setError(t("scheduleMustBeFuture"));
        return false;
      }
      return guarded("callback", async () => {
        const iso = when.toISOString();
        const r = await run({
          optimisticPatch: () => ({ status: "callback_scheduled", callback_scheduled_at: iso }),
          request: () => fetch(`/api/orders/${orderId}/callback`, { ...JSON_POST, body: JSON.stringify({ callback_time: iso }) }),
        });
        if (!r.ok) setError(httpError(r.status || 500));
        return r.ok;
      });
    },
    [guarded, run, orderId, httpError, t],
  );

  const dispatch = useCallback(
    (carrierId: string, opts: { stateId?: number | null; confirmDuplicate?: boolean }) =>
      guarded("dispatch", async (): Promise<DispatchResult> => {
        try {
          const res = await fetch(`/api/orders/${orderId}/dispatch`, {
            ...JSON_POST,
            body: JSON.stringify({
              carrier_id: carrierId,
              extra: opts.stateId != null ? { state_id: opts.stateId } : {},
              ...(opts.confirmDuplicate ? { confirm_duplicate: true } : {}),
            }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            needsConfirmation?: boolean;
            duplicate?: { external_id?: string | null };
            error?: unknown;
            data?: { tracking_number?: string | null };
          };
          // A sibling is already with the carrier: ask, never ship twice silently.
          if (res.status === 409 && json.needsConfirmation) {
            return { kind: "duplicate", externalId: json.duplicate?.external_id ?? null };
          }
          if (!res.ok) {
            setError(typeof json.error === "string" ? json.error : httpError(res.status));
            return { kind: "failed" };
          }
          return { kind: "sent", tracking: json.data?.tracking_number ?? null };
        } catch {
          setError(t("networkError"));
          return { kind: "failed" };
        }
      }),
    [guarded, orderId, httpError, t],
  );

  const schedule = useCallback(
    async (carrierId: string, when: Date, auto: boolean) => {
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        setError(t("scheduleMustBeFuture"));
        return false;
      }
      return guarded("schedule", async () => {
        const iso = when.toISOString();
        let serverError: string | null = null;
        const r = await run({
          optimisticPatch: () => ({
            status: "dispatch_scheduled",
            scheduled_dispatch_at: iso,
            scheduled_dispatch_auto: auto,
            scheduled_dispatch_carrier_id: carrierId,
          }),
          request: async () => {
            const res = await fetch(`/api/orders/${orderId}/schedule-dispatch`, {
              ...JSON_POST,
              body: JSON.stringify({ scheduled_at: iso, auto_dispatch: auto, carrier_id: carrierId }),
            });
            if (!res.ok) serverError = await readError(res);
            return res;
          },
        });
        if (!r.ok) setError(serverError ?? httpError(r.status || 500));
        return r.ok;
      });
    },
    [guarded, run, orderId, httpError, t],
  );

  /** « Supprimer celle-ci »: this order goes, as the duplicate of `twinId` (the route's anchor). */
  const deleteDuplicate = useCallback(
    (twinId: string) =>
      guarded("dup", async () => {
        try {
          const res = await fetch(`/api/orders/${twinId}/delete-duplicate`, { ...JSON_POST, body: JSON.stringify({ sibling_id: orderId }) });
          if (!res.ok) setError((await readError(res)) ?? httpError(res.status));
          return res.ok;
        } catch {
          setError(t("networkError"));
          return false;
        }
      }),
    [guarded, orderId, httpError, t],
  );

  return { busy, error, setError, noAnswer, confirm, reject, callback, dispatch, schedule, deleteDuplicate };
}

export type CallOutcome = ReturnType<typeof useCallOutcome>;
