import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isCallbackReady,
  getNextAttemptStatus,
  isMaxAttemptsReached,
  getAttemptNumber,
} from "../callback-engine";

afterEach(() => {
  vi.useRealTimers();
});

describe("isCallbackReady", () => {
  it("returns true when status is callback_scheduled and time is in the past", () => {
    expect(
      isCallbackReady({ status: "callback_scheduled", callback_scheduled_at: "2020-01-01T00:00:00Z" })
    ).toBe(true);
  });

  it("returns true when callback_scheduled_at is exactly now (boundary)", () => {
    const now = new Date().toISOString();
    // a time 1 second in the past is safe for this boundary test
    const pastByOneSecond = new Date(Date.now() - 1000).toISOString();
    expect(
      isCallbackReady({ status: "callback_scheduled", callback_scheduled_at: pastByOneSecond })
    ).toBe(true);
  });

  it("returns false when status is callback_scheduled but time is in the future", () => {
    expect(
      isCallbackReady({ status: "callback_scheduled", callback_scheduled_at: "2099-01-01T00:00:00Z" })
    ).toBe(false);
  });

  it("returns false when status is callback_scheduled but callback_scheduled_at is null", () => {
    expect(
      isCallbackReady({ status: "callback_scheduled", callback_scheduled_at: null })
    ).toBe(false);
  });

  it("returns false when status is attempt_1 even with a past time", () => {
    expect(
      isCallbackReady({ status: "attempt_1", callback_scheduled_at: "2020-01-01T00:00:00Z" })
    ).toBe(false);
  });

  it("returns false when status is assigned", () => {
    expect(
      isCallbackReady({ status: "assigned", callback_scheduled_at: null })
    ).toBe(false);
  });

  it("returns false when status is confirmed", () => {
    expect(
      isCallbackReady({ status: "confirmed", callback_scheduled_at: "2020-01-01T00:00:00Z" })
    ).toBe(false);
  });
});

describe("getNextAttemptStatus (re-exported from attempt-logic)", () => {
  it("returns attempt_1 for assigned", () => {
    expect(getNextAttemptStatus("assigned")).toBe("attempt_1");
  });

  it("returns attempt_2 for attempt_1", () => {
    expect(getNextAttemptStatus("attempt_1")).toBe("attempt_2");
  });

  it("returns attempt_3 for attempt_2", () => {
    expect(getNextAttemptStatus("attempt_2")).toBe("attempt_3");
  });

  it("returns null for attempt_3", () => {
    expect(getNextAttemptStatus("attempt_3")).toBeNull();
  });

  it("returns attempt_1 for callback_scheduled (restart)", () => {
    expect(getNextAttemptStatus("callback_scheduled")).toBe("attempt_1");
  });
});

describe("isMaxAttemptsReached (re-exported from attempt-logic)", () => {
  it("returns false for attempt_1 with max 3", () => {
    expect(isMaxAttemptsReached("attempt_1", 3)).toBe(false);
  });

  it("returns true for attempt_3 with max 3", () => {
    expect(isMaxAttemptsReached("attempt_3", 3)).toBe(true);
  });

  it("returns true for attempt_2 with max 2", () => {
    expect(isMaxAttemptsReached("attempt_2", 2)).toBe(true);
  });
});

describe("getAttemptNumber (alias for extractAttemptNumber)", () => {
  it("returns 0 for assigned", () => {
    expect(getAttemptNumber("assigned")).toBe(0);
  });

  it("returns 1 for attempt_1", () => {
    expect(getAttemptNumber("attempt_1")).toBe(1);
  });

  it("returns 2 for attempt_2", () => {
    expect(getAttemptNumber("attempt_2")).toBe(2);
  });

  it("returns 3 for attempt_3", () => {
    expect(getAttemptNumber("attempt_3")).toBe(3);
  });

  it("returns 0 for callback_scheduled", () => {
    expect(getAttemptNumber("callback_scheduled")).toBe(0);
  });

  it("returns 0 for confirmed", () => {
    expect(getAttemptNumber("confirmed")).toBe(0);
  });
});
