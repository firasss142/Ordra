import { describe, expect, it } from "vitest";
import { isDashKey, resolveDashWindow } from "../period";

const TODAY = "2026-10-04";
const FIRST = "2026-06-07";

describe("resolveDashWindow", () => {
  it("defaults to today, compared with yesterday at the same hour", () => {
    const w = resolveDashWindow(null, null, null, TODAY, FIRST);
    expect(w).toMatchObject({ key: "today", from: TODAY, to: TODAY, pf: "2026-10-03", pt: "2026-10-03", len: 1, lag: 1, live: true });
    expect(w.prev).toEqual({ kind: "yesterday" });
  });

  it("30 days compares with the 30 days before, read 30 days ago", () => {
    const w = resolveDashWindow("30d", null, null, TODAY, FIRST);
    expect(w).toMatchObject({ from: "2026-09-05", to: TODAY, pf: "2026-08-06", pt: "2026-09-04", lag: 30, live: true });
  });

  it("a whole month is not live and its lag is the gap between the two starts", () => {
    const w = resolveDashWindow("m:2026-09", null, null, TODAY, FIRST);
    expect(w).toMatchObject({ from: "2026-09-01", to: "2026-09-30", pf: "2026-08-01", pt: "2026-08-31", lag: 31, live: false });
  });

  it("knows its keys", () => {
    expect(isDashKey("today")).toBe(true);
    expect(isDashKey("30d")).toBe(true);
    expect(isDashKey("m:2026-09")).toBe(true);
    expect(isDashKey("year")).toBe(false);
  });
});
