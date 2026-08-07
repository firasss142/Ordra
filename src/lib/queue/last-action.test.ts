import { describe, it, expect } from "vitest";
import { classifyLastAction, LAST_ACTION_COLD_MINUTES } from "./last-action";

const NOW = new Date("2026-08-07T12:00:00Z").getTime();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("classifyLastAction", () => {
  it("reports 'never' when no agent has ever actioned the order", () => {
    const r = classifyLastAction({
      lastActionAt: null,
      status: "pending",
      attemptsCount: 0,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.tier).toBe("never");
    expect(r.minutes).toBeNull();
  });

  it("measures elapsed minutes since the last action", () => {
    const r = classifyLastAction({
      lastActionAt: minutesAgo(150),
      status: "attempt_1",
      attemptsCount: 1,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.minutes).toBe(150);
  });

  it("stays calm on a recent attempt", () => {
    const r = classifyLastAction({
      lastActionAt: minutesAgo(60),
      status: "attempt_1",
      attemptsCount: 1,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.tier).toBe("calm");
  });

  it("goes cold on an attempt untouched past the threshold with retries left", () => {
    const r = classifyLastAction({
      lastActionAt: minutesAgo(LAST_ACTION_COLD_MINUTES + 1),
      status: "attempt_2",
      attemptsCount: 2,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.tier).toBe("cold");
  });

  it("does NOT go cold once attempts are exhausted — there is no retry to be late for", () => {
    const r = classifyLastAction({
      lastActionAt: minutesAgo(LAST_ACTION_COLD_MINUTES * 3),
      status: "attempt_3",
      attemptsCount: 8,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.tier).toBe("calm");
  });

  it("does NOT go cold on a settled order however long ago it was touched", () => {
    for (const status of ["uploaded", "delivered", "rejected", "cancelled", "returned"]) {
      const r = classifyLastAction({
        lastActionAt: minutesAgo(LAST_ACTION_COLD_MINUTES * 10),
        status,
        attemptsCount: 3,
        maxAttempts: 8,
        nowMs: NOW,
      });
      expect(r.tier, `${status} should stay calm`).toBe("calm");
    }
  });

  it("does NOT go cold on a scheduled callback — the schedule owns the clock", () => {
    // A callback booked for next week is not neglected; its own due time is the
    // signal, and that already escalates the status pill.
    const r = classifyLastAction({
      lastActionAt: minutesAgo(LAST_ACTION_COLD_MINUTES * 2),
      status: "callback_scheduled",
      attemptsCount: 1,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.tier).toBe("calm");
  });

  it("treats a missing maxAttempts as 'ceiling unknown' and never invents a cold state", () => {
    // Mirrors useMaxCallAttempts returning null until settings load: better to
    // stay quiet than to flag a retry that may not be owed.
    const r = classifyLastAction({
      lastActionAt: minutesAgo(LAST_ACTION_COLD_MINUTES * 2),
      status: "attempt_1",
      attemptsCount: 1,
      maxAttempts: null,
      nowMs: NOW,
    });
    expect(r.tier).toBe("calm");
  });

  it("clamps a future timestamp to zero rather than reporting negative minutes", () => {
    const r = classifyLastAction({
      lastActionAt: new Date(NOW + 60_000).toISOString(),
      status: "attempt_1",
      attemptsCount: 1,
      maxAttempts: 8,
      nowMs: NOW,
    });
    expect(r.minutes).toBe(0);
  });
});
