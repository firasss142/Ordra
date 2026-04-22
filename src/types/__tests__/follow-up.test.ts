import { describe, test, expect } from "vitest";
import {
  FOLLOW_UP_STATUSES,
  isTerminalFollowUpStatus,
  isValidFollowUpTransition,
} from "../follow-up";

describe("FOLLOW_UP_STATUSES", () => {
  test("has exactly 4 statuses", () => {
    expect(FOLLOW_UP_STATUSES).toEqual([
      "open",
      "in_progress",
      "resolved",
      "escalated",
    ]);
  });
});

describe("isTerminalFollowUpStatus", () => {
  test("resolved is terminal in UI sense (can still be reopened)", () => {
    expect(isTerminalFollowUpStatus("resolved")).toBe(true);
  });

  test("open/in_progress/escalated are active", () => {
    expect(isTerminalFollowUpStatus("open")).toBe(false);
    expect(isTerminalFollowUpStatus("in_progress")).toBe(false);
    expect(isTerminalFollowUpStatus("escalated")).toBe(false);
  });
});

describe("isValidFollowUpTransition", () => {
  test("open can go to in_progress, resolved, escalated", () => {
    expect(isValidFollowUpTransition("open", "in_progress")).toBe(true);
    expect(isValidFollowUpTransition("open", "resolved")).toBe(true);
    expect(isValidFollowUpTransition("open", "escalated")).toBe(true);
  });

  test("in_progress can go to open, resolved, escalated", () => {
    expect(isValidFollowUpTransition("in_progress", "open")).toBe(true);
    expect(isValidFollowUpTransition("in_progress", "resolved")).toBe(true);
    expect(isValidFollowUpTransition("in_progress", "escalated")).toBe(true);
  });

  test("escalated can go to in_progress or resolved, not back to open", () => {
    expect(isValidFollowUpTransition("escalated", "in_progress")).toBe(true);
    expect(isValidFollowUpTransition("escalated", "resolved")).toBe(true);
    expect(isValidFollowUpTransition("escalated", "open")).toBe(false);
  });

  test("resolved can only be reopened to in_progress", () => {
    expect(isValidFollowUpTransition("resolved", "in_progress")).toBe(true);
    expect(isValidFollowUpTransition("resolved", "open")).toBe(false);
    expect(isValidFollowUpTransition("resolved", "escalated")).toBe(false);
  });

  test("self-transitions are rejected", () => {
    FOLLOW_UP_STATUSES.forEach((s) => {
      expect(isValidFollowUpTransition(s, s)).toBe(false);
    });
  });
});
