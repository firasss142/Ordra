import { describe, it, expect } from "vitest";
import { periodDeltaProps } from "../periodDelta";

describe("periodDeltaProps", () => {
  it("returns '—' and neutral when delta is null", () => {
    expect(periodDeltaProps(null)).toEqual({ deltaText: "—", deltaTone: "neutral" });
  });

  it("formats positive pct with + sign and success tone", () => {
    const result = periodDeltaProps({ abs: 100, pct: 0.2, direction: "up" });
    expect(result.deltaText).toBe("+20.0%");
    expect(result.deltaTone).toBe("success");
  });

  it("formats negative pct and critical tone", () => {
    const result = periodDeltaProps({ abs: -50, pct: -0.1, direction: "down" });
    expect(result.deltaText).toBe("-10.0%");
    expect(result.deltaTone).toBe("critical");
  });

  it("returns neutral tone for flat direction", () => {
    const result = periodDeltaProps({ abs: 0, pct: 0, direction: "flat" });
    expect(result.deltaTone).toBe("neutral");
  });

  it("inverts tone when invert=true (costs going up = bad)", () => {
    const result = periodDeltaProps(
      { abs: 10, pct: 0.1, direction: "up" },
      { invert: true },
    );
    expect(result.deltaTone).toBe("critical");
  });

  it("falls back to abs formatting when pct is null (prev was 0)", () => {
    const result = periodDeltaProps({ abs: 42, pct: null, direction: "up" });
    expect(result.deltaText).toBe("+42");
    expect(result.deltaTone).toBe("success");
  });

  it("returns empty label when pct=null and direction=flat (both periods 0)", () => {
    const result = periodDeltaProps({ abs: 0, pct: null, direction: "flat" });
    expect(result.deltaText).toBe("—");
    expect(result.deltaTone).toBe("neutral");
  });

  it("formats as percentage points when pp=true", () => {
    const result = periodDeltaProps(
      { abs: 2.2, pct: 0.022, direction: "up" },
      { pp: true },
    );
    expect(result.deltaText).toBe("+2.2 pp");
  });
});
