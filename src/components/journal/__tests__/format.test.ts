import { afterEach, describe, expect, test, vi } from "vitest";
import { makeFmt } from "../format";

/**
 * The screen makes its formatter once, at mount, and SWR refreshes the journal
 * every minute. « il y a 4 min » must be measured against the clock NOW, not
 * against the moment the page opened — and a server stamp a few seconds ahead
 * of the browser's clock is « maintenant », not « dans 1 seconde ».
 */
afterEach(() => vi.useRealTimers());

describe("makeFmt.relative", () => {
  test("without a fixed now, it follows the live clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const f = makeFmt("fr", "Africa/Tripoli", (s) => s);
    vi.setSystemTime(new Date("2026-10-09T10:10:00Z"));
    expect(f.relative("2026-10-09T10:06:00Z")).toBe("il y a 4 minutes");
  });

  test("a stamp a few seconds in the future reads as now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const f = makeFmt("fr", "Africa/Tripoli", (s) => s);
    expect(f.relative("2026-10-09T10:00:02Z")).toBe("maintenant");
  });

  test("a fixed now stays fixed (the describe tests rely on it)", () => {
    const f = makeFmt("fr", "Africa/Tripoli", (s) => s, new Date("2026-10-03T14:40:00Z"));
    expect(f.relative("2026-10-03T14:36:00Z")).toBe("il y a 4 minutes");
  });
});
