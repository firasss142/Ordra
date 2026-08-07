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
    expect(formatOrderAge(45, "fr")).toMatch(/45\s*min/);
    expect(formatOrderAge(180, "fr")).toMatch(/3\s*h/);
    expect(formatOrderAge(2880, "fr")).toMatch(/2\s*j/);
  });

  test("never renders a bare zero", () => {
    expect(formatOrderAge(0, "fr")).toMatch(/min/);
  });

  test("uses Arabic day and hour units for the ar locale", () => {
    expect(formatOrderAge(2880, "ar")).not.toMatch(/j$/);
  });
});
