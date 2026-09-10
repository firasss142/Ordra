import { describe, it, expect } from "vitest";
import {
  ORDER_LOCKED_SQLSTATE,
  LOCK_TTL_SECONDS,
  LOCK_HEARTBEAT_MS,
  OrderLockedError,
  readOrderLockError,
  lockedResponseBody,
} from "../order-lock";
import { readActionFailure } from "../action-failure";

const DETAIL = JSON.stringify({
  order_id: "o-1",
  holder_id: "agent-9",
  holder_name: "Salima",
  since: "2026-09-10T10:00:00.000Z",
  expires_at: "2026-09-10T10:01:15.000Z",
});

describe("readOrderLockError", () => {
  it("parses a 55006 PostgREST error into lock info", () => {
    const info = readOrderLockError({ code: ORDER_LOCKED_SQLSTATE, details: DETAIL });
    expect(info).toEqual({
      order_id: "o-1",
      holder_id: "agent-9",
      holder_name: "Salima",
      since: "2026-09-10T10:00:00.000Z",
      expires_at: "2026-09-10T10:01:15.000Z",
    });
  });

  it("returns null for an unrelated SQLSTATE", () => {
    expect(readOrderLockError({ code: "23514", details: DETAIL })).toBeNull();
  });

  it("returns null for null / undefined", () => {
    expect(readOrderLockError(null)).toBeNull();
    expect(readOrderLockError(undefined)).toBeNull();
  });

  // The guard always sends DETAIL, but a malformed one must not 500 the route.
  it("still reports a lock when DETAIL is unparseable", () => {
    const info = readOrderLockError({ code: ORDER_LOCKED_SQLSTATE, details: "not json" });
    expect(info).not.toBeNull();
    expect(info?.holder_name).toBeNull();
  });

  // The RPC wrappers used to do `throw new Error(error.message)`, which threw
  // away `code` and `details`. This is the shape that must survive.
  it("reads a lock off an OrderLockedError thrown by a wrapper", () => {
    const err = new OrderLockedError({ code: ORDER_LOCKED_SQLSTATE, details: DETAIL });
    expect(err).toBeInstanceOf(Error);
    expect(err.lock.holder_name).toBe("Salima");
  });
});

describe("lockedResponseBody", () => {
  it("produces the 409 body the client branches on", () => {
    const info = readOrderLockError({ code: ORDER_LOCKED_SQLSTATE, details: DETAIL })!;
    const body = lockedResponseBody(info);
    expect(body.code).toBe("locked");
    expect(body.lock).toEqual(info);
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("Salima");
  });

  it("falls back to generic copy when the holder has no name", () => {
    const body = lockedResponseBody({
      order_id: "o-1",
      holder_id: "agent-9",
      holder_name: null,
      since: null,
      expires_at: null,
    });
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("readActionFailure — locked", () => {
  it("surfaces lock info and still reports conflict so the list refreshes", () => {
    const info = readOrderLockError({ code: ORDER_LOCKED_SQLSTATE, details: DETAIL })!;
    const failure = readActionFailure(409, lockedResponseBody(info));
    expect(failure.locked).toEqual(info);
    expect(failure.conflict).toBe(true);
    expect(failure.message).toContain("Salima");
  });

  it("leaves locked null for an ordinary conflict", () => {
    const failure = readActionFailure(409, { code: "conflict", error: "Modifiée entre-temps." });
    expect(failure.locked).toBeNull();
    expect(failure.conflict).toBe(true);
  });
});

describe("constants", () => {
  it("keeps three heartbeats inside the TTL", () => {
    expect(LOCK_HEARTBEAT_MS * 3).toBeLessThanOrEqual(LOCK_TTL_SECONDS * 1000);
  });
});
