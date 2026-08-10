import { describe, test, expect } from "vitest";
import { classifyOrderAge, formatOrderAge } from "./order-age";

const NOW = new Date("2026-08-06T16:20:00Z").getTime();
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

describe("classifyOrderAge", () => {
  test("escalates while an order is still waiting on a human", () => {
    expect(classifyOrderAge(ago(30), "pending", NOW).tier).toBe("fresh");
    expect(classifyOrderAge(ago(300), "pending", NOW).tier).toBe("warm");
    expect(classifyOrderAge(ago(3000), "pending", NOW).tier).toBe("late");
  });

  test("treats every unanswered-call status as still open", () => {
    for (const status of ["pending", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled"]) {
      expect(classifyOrderAge(ago(3000), status, NOW).tier, status).toBe("late");
    }
  });

  test("stops ageing once the order leaves the agent's hands", () => {
    // A delivered order from three weeks ago is not 'late' — it is done.
    // Colouring closed orders red makes the whole heat map useless.
    for (const status of ["confirmed", "uploaded", "delivered", "rejected", "cancelled", "returned"]) {
      expect(classifyOrderAge(ago(30_000), status, NOW).tier, status).toBe("settled");
    }
  });

  test("boundaries land on the documented side", () => {
    expect(classifyOrderAge(ago(119), "pending", NOW).tier).toBe("fresh");
    expect(classifyOrderAge(ago(120), "pending", NOW).tier).toBe("warm");
    expect(classifyOrderAge(ago(1439), "pending", NOW).tier).toBe("warm");
    expect(classifyOrderAge(ago(1440), "pending", NOW).tier).toBe("late");
  });

  test("only a late, still-open order counts as an SLA breach", () => {
    expect(classifyOrderAge(ago(3000), "pending", NOW).isBreach).toBe(true);
    expect(classifyOrderAge(ago(3000), "delivered", NOW).isBreach).toBe(false);
    expect(classifyOrderAge(ago(30), "pending", NOW).isBreach).toBe(false);
  });

  test("reports elapsed minutes for callers that need the raw value", () => {
    expect(classifyOrderAge(ago(90), "pending", NOW).minutes).toBe(90);
  });

  test("a future timestamp clamps to zero rather than going negative", () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(classifyOrderAge(future, "pending", NOW).minutes).toBe(0);
    expect(classifyOrderAge(future, "pending", NOW).tier).toBe("fresh");
  });
});

describe("formatOrderAge", () => {
  test("reads in minutes, then hours, then days", () => {
    expect(formatOrderAge(45, "fr")).toBe("45mn");
    expect(formatOrderAge(180, "fr")).toBe("3h");
    expect(formatOrderAge(2880, "fr")).toBe("2d");
  });

  // A floored single unit reported "3h" for anything from 3h00 to 3h59, so two
  // orders an hour apart in real urgency read identically.
  test("carries a second unit when there is a remainder", () => {
    expect(formatOrderAge(135, "fr")).toBe("2h 15mn");
    expect(formatOrderAge(1680, "fr")).toBe("1d 4h");
  });

  test("drops the second unit when it would be zero", () => {
    expect(formatOrderAge(120, "fr")).toBe("2h");
    expect(formatOrderAge(1440, "fr")).toBe("1d");
  });

  // Past a week the remainder stops being actionable and only adds noise.
  test("shows days alone once the order is a week old", () => {
    expect(formatOrderAge(7 * 1440 + 300, "fr")).toBe("7d");
    expect(formatOrderAge(12 * 1440 + 700, "fr")).toBe("12d");
  });

  test("never renders a bare zero", () => {
    expect(formatOrderAge(0, "fr")).toBe("1mn");
  });

  test("uses Arabic units for the ar locale", () => {
    expect(formatOrderAge(45, "ar")).toBe("45د");
    expect(formatOrderAge(135, "ar")).toBe("2س 15د");
    expect(formatOrderAge(2880, "ar")).toBe("2ي");
  });

  test("falls back to French units for an unknown locale", () => {
    expect(formatOrderAge(135, "es")).toBe("2h 15mn");
  });
});
