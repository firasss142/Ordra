import { describe, it, expect } from "vitest";
import { calculateConfirmationRate, calculateAvgAttempts } from "./metrics";

describe("calculateConfirmationRate", () => {
  it("returns 50.0 for 5 confirmed of 10 actioned", () => {
    expect(calculateConfirmationRate(5, 10)).toBe(50.0);
  });

  it("returns 0 when actioned is 0", () => {
    expect(calculateConfirmationRate(0, 0)).toBe(0);
  });

  it("returns 100.0 when all actioned are confirmed", () => {
    expect(calculateConfirmationRate(10, 10)).toBe(100.0);
  });

  it("rounds to 1 decimal place", () => {
    expect(calculateConfirmationRate(1, 3)).toBe(33.3);
  });
});

describe("calculateAvgAttempts", () => {
  it("returns 3.0 for 15 total attempts across 5 actioned orders", () => {
    expect(calculateAvgAttempts(15, 5)).toBe(3.0);
  });

  it("returns 0 when actionedCount is 0", () => {
    expect(calculateAvgAttempts(0, 0)).toBe(0);
  });

  it("rounds to 1 decimal place", () => {
    expect(calculateAvgAttempts(10, 3)).toBe(3.3);
  });
});
