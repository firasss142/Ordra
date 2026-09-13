import { describe, test, expect } from "vitest";
import { inTwoHours, tomorrowAt } from "../schedule";

describe("next-step presets", () => {
  test("+2 h is plain arithmetic", () => {
    const now = Date.parse("2026-09-13T10:00:00Z");
    expect(inTwoHours(now)).toBe("2026-09-13T12:00:00.000Z");
  });

  test("tomorrow 10:00 is 10:00 on the market clock, not the browser's", () => {
    // 23:30 UTC on the 13th is already 01:30 on the 14th in Tripoli (UTC+2),
    // so "tomorrow" is the 15th there.
    const lateUtc = Date.parse("2026-09-13T23:30:00Z");
    expect(tomorrowAt(lateUtc, "Africa/Tripoli", 10)).toBe("2026-09-15T08:00:00.000Z");
    // Tunis is UTC+1.
    const morning = Date.parse("2026-09-13T07:00:00Z");
    expect(tomorrowAt(morning, "Africa/Tunis", 10)).toBe("2026-09-14T09:00:00.000Z");
  });
});
