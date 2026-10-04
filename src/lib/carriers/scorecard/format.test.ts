import { describe, it, expect } from "vitest";
import { fmtDays, fmtInt, fmtMonth, fmtPct, fmtPoints, fmtWeek, syncAge } from "./format";

const NNBSP = " ";

describe("scorecard format", () => {
  it("groups thousands with a space and keeps Latin digits in both languages", () => {
    expect(fmtInt("fr", 1210).replace(/\s/g, " ")).toBe("1 210");
    expect(fmtInt("ar", 1210).replace(/\s/g, " ")).toBe("1 210");
  });
  it("writes a percentage the way each language does", () => {
    expect(fmtPct("fr", 50.86)).toBe(`51${NNBSP}%`);
    expect(fmtPct("ar", 50.86)).toBe("51%");
    expect(fmtPct("fr", null)).toBe("—");
  });
  it("writes days and points with one decimal", () => {
    expect(fmtDays("fr", 1.2)).toBe("1,2");
    expect(fmtDays("ar", 1.2)).toBe("1.2");
    expect(fmtPoints("fr", 3.24)).toBe("3,2");
  });
  it("names a week by its Monday and a month by its name", () => {
    expect(fmtWeek("fr", "2026-09-14")).toBe("14 sept.");
    expect(fmtWeek("ar", "2026-09-14")).toBe("14 سبتمبر");
    expect(fmtMonth("fr", "2026-05-30T10:00:00Z")).toBe("mai");
  });
  it("tells how long ago the carrier sync ran", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(syncAge("2026-10-03T11:52:00Z", now)).toEqual({ unit: "min", n: 8 });
    expect(syncAge("2026-10-03T09:00:00Z", now)).toEqual({ unit: "hour", n: 3 });
    expect(syncAge("2026-10-01T09:00:00Z", now)).toEqual({ unit: "day", n: 2 });
    expect(syncAge("2026-10-03T11:59:50Z", now)).toEqual({ unit: "min", n: 1 });
  });
});
