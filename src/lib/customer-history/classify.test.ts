import { describe, it, expect } from "vitest";
import {
  normalizeIdentity,
  classifyRepeatKind,
  computeRiskRatio,
  type OutcomeBreakdown,
} from "./classify";

describe("normalizeIdentity", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeIdentity("  Ahmed  Ben  Salah  ")).toBe("ahmed ben salah");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeIdentity(null)).toBe("");
    expect(normalizeIdentity(undefined)).toBe("");
    expect(normalizeIdentity("")).toBe("");
    expect(normalizeIdentity("   ")).toBe("");
  });

  it("treats internal multiple spaces and tabs as single space", () => {
    expect(normalizeIdentity("Foo\t\tBar")).toBe("foo bar");
    expect(normalizeIdentity("Foo   Bar\nBaz")).toBe("foo bar baz");
  });
});

describe("computeRiskRatio", () => {
  it("returns 0 when no terminal outcomes", () => {
    expect(computeRiskRatio({ delivered: 0, returned: 0, rejected: 0 })).toBe(0);
  });

  it("computes rejected / (rejected + delivered + returned)", () => {
    expect(
      computeRiskRatio({ delivered: 1, returned: 1, rejected: 2 }),
    ).toBeCloseTo(0.5);
  });

  it("ignores open orders (only terminal outcomes count)", () => {
    // open = total - terminal; not part of input
    expect(
      computeRiskRatio({ delivered: 3, returned: 0, rejected: 1 }),
    ).toBeCloseTo(0.25);
  });
});

describe("classifyRepeatKind", () => {
  function breakdown(
    o: Partial<OutcomeBreakdown> = {},
  ): OutcomeBreakdown {
    return { delivered: 0, returned: 0, rejected: 0, ...o };
  }

  it("returns 'none' when there are no prior orders or leads", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 0,
        priorLeadCount: 0,
        phoneMatched: false,
        outcomes: breakdown(),
      }),
    ).toBe("none");
  });

  it("returns 'risk' when ≥2 prior orders and rejection rate ≥50%", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 2,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ delivered: 1, rejected: 1 }),
      }),
    ).toBe("risk");

    expect(
      classifyRepeatKind({
        priorOrderCount: 4,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ delivered: 1, rejected: 3 }),
      }),
    ).toBe("risk");
  });

  it("does not flag 'risk' below the 2-order threshold even if 100% rejected", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 1,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ rejected: 1 }),
      }),
    ).toBe("repeat");
  });

  it("does not flag 'risk' when rejection rate is below 50%", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 4,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ delivered: 3, rejected: 1 }),
      }),
    ).toBe("repeat");
  });

  it("'risk' takes precedence over 'repeat' even with phone match", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 3,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ delivered: 1, rejected: 2 }),
      }),
    ).toBe("risk");
  });

  it("returns 'repeat' when phone matched and ≥1 prior order, no risk", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 1,
        priorLeadCount: 0,
        phoneMatched: true,
        outcomes: breakdown({ delivered: 1 }),
      }),
    ).toBe("repeat");
  });

  it("returns 'likely' when only identity-matched (no phone match) with prior orders", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 2,
        priorLeadCount: 0,
        phoneMatched: false,
        outcomes: breakdown({ delivered: 2 }),
      }),
    ).toBe("likely");
  });

  it("returns 'likely' when only leads matched (no prior orders)", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 0,
        priorLeadCount: 2,
        phoneMatched: true,
        outcomes: breakdown(),
      }),
    ).toBe("likely");
  });

  it("never flags 'risk' when there are 0 prior orders, even if leads exist", () => {
    expect(
      classifyRepeatKind({
        priorOrderCount: 0,
        priorLeadCount: 5,
        phoneMatched: true,
        outcomes: breakdown(),
      }),
    ).toBe("likely");
  });
});
