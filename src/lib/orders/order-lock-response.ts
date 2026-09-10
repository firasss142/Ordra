import { NextResponse } from "next/server";
import { readOrderLockError, lockedResponseBody } from "./order-lock";

/**
 * Server-only translation of the lock guard into an HTTP answer.
 *
 * Kept apart from order-lock.ts on purpose: that module is imported by client
 * code (readActionFailure runs in the browser), and pulling `next/server` into
 * it would drag server runtime into the client bundle.
 *
 * 409 rather than 423 Locked: the codebase already answers 409 for "somebody
 * else got there first" and readActionFailure keys on it, so callers that only
 * understand `conflict` keep working with no change.
 */
export function lockedResponse(err: unknown): NextResponse | null {
  const lock = readOrderLockError(err);
  if (!lock) return null;
  return NextResponse.json(lockedResponseBody(lock), { status: 409 });
}
