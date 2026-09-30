import { describe, it, expect } from "vitest";
import { backoffDelayMs, nextAttemptAt, MAX_DELAY_MS } from "../backoff";

describe("backoff", () => {
  const noJitter = () => 0;
  it("doubles from 30 s and caps at 30 min", () => {
    expect(backoffDelayMs(1, noJitter)).toBe(30_000);
    expect(backoffDelayMs(2, noJitter)).toBe(60_000);
    expect(backoffDelayMs(3, noJitter)).toBe(120_000);
    expect(backoffDelayMs(6, noJitter)).toBe(960_000);
    expect(backoffDelayMs(7, noJitter)).toBe(MAX_DELAY_MS);
    expect(backoffDelayMs(40, noJitter)).toBe(MAX_DELAY_MS);
  });
  it("adds up to 5 s of jitter and treats a zero attempt count as the first", () => {
    expect(backoffDelayMs(1, () => 0.999)).toBeLessThan(35_000);
    expect(backoffDelayMs(0, noJitter)).toBe(30_000);
  });
  it("schedules from a given clock", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(nextAttemptAt(2, now, noJitter).toISOString()).toBe("2026-09-25T12:01:00.000Z");
  });
});
