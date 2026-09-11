/**
 * The order lock, as the API layer sees it.
 *
 * While an AGENT has an order's detail view open, `assert_order_unlocked` (see
 * 20260925000003) refuses every manager write on it and raises SQLSTATE 55006
 * with a JSON DETAIL naming the holder. This module is the single place that
 * turns that Postgres error into the 409 body the client branches on, and back.
 *
 * Manager presence never raises anything — it is advisory, and an agent
 * mid-call is never frozen by it.
 */

/** object_in_use. Chosen because it cannot be confused with a bare P0001. */
export const ORDER_LOCKED_SQLSTATE = "55006";

/** Server-side lifetime of a presence row, in seconds. Mirrors the RPC default. */
export const LOCK_TTL_SECONDS = 75;

/** Client heartbeat cadence. Three beats fit inside the TTL, so two may be lost. */
export const LOCK_HEARTBEAT_MS = 25_000;

export interface OrderLockInfo {
  order_id: string | null;
  holder_id: string | null;
  holder_name: string | null;
  since: string | null;
  expires_at: string | null;
}

export interface OrderLockedBody {
  code: "locked";
  error: string;
  lock: OrderLockInfo;
}

/** The subset of a PostgREST error we need. Deliberately structural. */
export interface PgErrorLike {
  code?: string | null;
  details?: string | null;
  message?: string | null;
}

/**
 * Thrown by the RPC wrappers in place of `new Error(error.message)`.
 *
 * That old shape destroyed `code` and `details`, so every route behind
 * assignment.ts / transition.ts / manual-delete.ts received the bare string
 * "order_locked" and could not tell a lock from any other failure. Nothing
 * failed loudly when that happened — the block simply never surfaced.
 */
export class OrderLockedError extends Error {
  readonly code = "locked" as const;
  readonly lock: OrderLockInfo;

  constructor(pgError: PgErrorLike) {
    const lock = parseDetail(pgError.details ?? null);
    super(lock.holder_name ? `order_locked:${lock.holder_name}` : "order_locked");
    this.name = "OrderLockedError";
    this.lock = lock;
  }
}

function parseDetail(details: string | null): OrderLockInfo {
  const empty: OrderLockInfo = {
    order_id: null,
    holder_id: null,
    holder_name: null,
    since: null,
    expires_at: null,
  };
  if (!details) return empty;
  try {
    const raw = JSON.parse(details) as Record<string, unknown>;
    const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
    return {
      order_id: str("order_id"),
      holder_id: str("holder_id"),
      holder_name: str("holder_name"),
      since: str("since"),
      expires_at: str("expires_at"),
    };
  } catch {
    // A malformed DETAIL must still read as "locked" — losing the holder's name
    // is a worse message, not a different outcome.
    return empty;
  }
}

/**
 * Lock info if this error is the guard firing, else null.
 * Accepts a raw PostgREST error or an already-typed OrderLockedError.
 */
export function readOrderLockError(err: unknown): OrderLockInfo | null {
  if (!err || typeof err !== "object") return null;
  if (err instanceof OrderLockedError) return err.lock;
  const e = err as PgErrorLike;
  if (e.code !== ORDER_LOCKED_SQLSTATE) return null;
  return parseDetail(e.details ?? null);
}

/** True when this error is the lock guard, whatever shape it arrived in. */
export function isOrderLockedError(err: unknown): boolean {
  return readOrderLockError(err) !== null;
}

/**
 * Rethrows as OrderLockedError when the guard fired, so the code survives the
 * wrapper. Any other error is returned for the caller to handle as before.
 */
export function asOrderLockedError(err: PgErrorLike | null): OrderLockedError | null {
  if (!err || err.code !== ORDER_LOCKED_SQLSTATE) return null;
  return new OrderLockedError(err);
}

export function lockedResponseBody(lock: OrderLockInfo): OrderLockedBody {
  return {
    code: "locked",
    error: lock.holder_name
      ? `${lock.holder_name} a cette commande ouverte. Réessayez dans un instant.`
      : "Un agent a cette commande ouverte. Réessayez dans un instant.",
    lock,
  };
}
