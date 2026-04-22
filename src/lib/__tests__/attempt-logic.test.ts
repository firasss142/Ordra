import { describe, it, expect } from "vitest";
import {
  getNextAttemptStatus,
  extractAttemptNumber,
  isMaxAttemptsReached,
} from "../attempt-logic";

describe("getNextAttemptStatus", () => {
  it("returns attempt_1 for assigned", () => {
    expect(getNextAttemptStatus("assigned")).toBe("attempt_1");
  });

  it("returns attempt_2 for attempt_1", () => {
    expect(getNextAttemptStatus("attempt_1")).toBe("attempt_2");
  });

  it("returns attempt_3 for attempt_2", () => {
    expect(getNextAttemptStatus("attempt_2")).toBe("attempt_3");
  });

  it("returns attempt_1 for callback_scheduled (restart attempts)", () => {
    expect(getNextAttemptStatus("callback_scheduled")).toBe("attempt_1");
  });

  it("returns null for attempt_3 (no further attempt)", () => {
    expect(getNextAttemptStatus("attempt_3")).toBeNull();
  });

  it("returns null for confirmed (not an attemptable status)", () => {
    expect(getNextAttemptStatus("confirmed")).toBeNull();
  });

  it("returns null for rejected (terminal)", () => {
    expect(getNextAttemptStatus("rejected")).toBeNull();
  });
});

describe("extractAttemptNumber", () => {
  it("returns 0 for assigned", () => {
    expect(extractAttemptNumber("assigned")).toBe(0);
  });

  it("returns 1 for attempt_1", () => {
    expect(extractAttemptNumber("attempt_1")).toBe(1);
  });

  it("returns 2 for attempt_2", () => {
    expect(extractAttemptNumber("attempt_2")).toBe(2);
  });

  it("returns 3 for attempt_3", () => {
    expect(extractAttemptNumber("attempt_3")).toBe(3);
  });

  it("returns 0 for callback_scheduled", () => {
    expect(extractAttemptNumber("callback_scheduled")).toBe(0);
  });

  it("returns 0 for any non-attempt status", () => {
    expect(extractAttemptNumber("confirmed")).toBe(0);
    expect(extractAttemptNumber("new")).toBe(0);
  });
});

describe("isMaxAttemptsReached", () => {
  it("returns false for assigned with max 3", () => {
    expect(isMaxAttemptsReached("assigned", 3)).toBe(false);
  });

  it("returns false for attempt_1 with max 3", () => {
    expect(isMaxAttemptsReached("attempt_1", 3)).toBe(false);
  });

  it("returns false for attempt_2 with max 3", () => {
    expect(isMaxAttemptsReached("attempt_2", 3)).toBe(false);
  });

  it("returns true for attempt_3 with max 3 (next would exceed)", () => {
    expect(isMaxAttemptsReached("attempt_3", 3)).toBe(true);
  });

  it("returns true for attempt_2 with max 2", () => {
    expect(isMaxAttemptsReached("attempt_2", 2)).toBe(true);
  });

  it("returns true for attempt_1 with max 1", () => {
    expect(isMaxAttemptsReached("attempt_1", 1)).toBe(true);
  });

  it("returns false for callback_scheduled with max 3 (not an attempt)", () => {
    expect(isMaxAttemptsReached("callback_scheduled", 3)).toBe(false);
  });
});
