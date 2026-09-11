/**
 * What a failed order action means for the list the user is looking at.
 *
 * Two people acting on the same order is the normal case in this OMS: an agent
 * confirms while the manager is cancelling, the Darb sync advances a status
 * while somebody is editing. The server already refuses the second write — the
 * transition RPC locks the row and re-checks the from-status — but the page
 * used to render that refusal as a generic red banner and leave a list that
 * still showed the old status. The user's next click then failed the same way.
 *
 * A "conflict" here means: your view was out of date, so refresh it. It is
 * deliberately wider than one status code — the cancel and recover routes
 * answer 409 with their own vocabulary, and every one of those cases also means
 * the order moved.
 */
import { readOrderLockError, type OrderLockInfo } from "./order-lock";

export interface ActionFailure {
  /** The list is stale: refresh it before showing the message. */
  conflict: boolean;
  /** The server's own sentence, when it sent one. Prefer it over generic copy. */
  message: string | null;
  /** The status the order actually holds now, when the server named it. */
  freshStatus: string | null;
  /**
   * Set when the refusal was the agent-presence lock rather than a stale view.
   * `conflict` stays true alongside it: the list should still refresh, and
   * callers that only know about `conflict` keep working unchanged.
   */
  locked: OrderLockInfo | null;
}

export function readActionFailure(status: number, body: unknown): ActionFailure {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const message = typeof b.error === "string" ? b.error : null;
  const freshStatus = typeof b.status === "string" ? b.status : null;
  const conflict = b.code === "conflict" || status === 409;

  const locked =
    b.code === "locked" && typeof b.lock === "object" && b.lock !== null
      ? (b.lock as OrderLockInfo)
      : readOrderLockError(b);

  return { conflict, message, freshStatus, locked };
}
