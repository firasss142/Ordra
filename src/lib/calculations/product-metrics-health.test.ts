import { describe, test, expect } from "vitest";
import { classifyProductHealth, type HealthInput } from "./product-metrics-health";

function healthy(): HealthInput {
  return { totalLeads: 100, marginPct: 20, deliveryRate: 75, returnRate: 10 };
}

describe("classifyProductHealth", () => {
  test("returns grey when totalLeads is 0", () => {
    expect(classifyProductHealth({ ...healthy(), totalLeads: 0 })).toBe("grey");
  });

  test("returns red when marginPct < 0", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: -1 })).toBe("red");
  });

  test("returns red when marginPct exactly -0.1", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: -0.1 })).toBe("red");
  });

  test("returns yellow when marginPct exactly 0 (boundary)", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: 0 })).toBe("yellow");
  });

  test("returns yellow when marginPct < 10", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: 5 })).toBe("yellow");
  });

  test("returns yellow when marginPct exactly 10 (boundary — not yet green)", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: 10 })).toBe("yellow");
  });

  test("returns green when marginPct > 10", () => {
    expect(classifyProductHealth({ ...healthy(), marginPct: 10.1 })).toBe("green");
  });

  test("returns yellow when deliveryRate < 60", () => {
    expect(classifyProductHealth({ ...healthy(), deliveryRate: 59.9 })).toBe("yellow");
  });

  test("returns yellow when deliveryRate exactly 60 (boundary)", () => {
    expect(classifyProductHealth({ ...healthy(), deliveryRate: 60 })).toBe("yellow");
  });

  test("returns green when deliveryRate > 60", () => {
    expect(classifyProductHealth({ ...healthy(), deliveryRate: 60.1 })).toBe("green");
  });

  test("returns yellow when returnRate > 20", () => {
    expect(classifyProductHealth({ ...healthy(), returnRate: 20.1 })).toBe("yellow");
  });

  test("returns yellow when returnRate exactly 20 (boundary)", () => {
    expect(classifyProductHealth({ ...healthy(), returnRate: 20 })).toBe("yellow");
  });

  test("returns green when returnRate < 20", () => {
    expect(classifyProductHealth({ ...healthy(), returnRate: 19.9 })).toBe("green");
  });

  test("returns green when all metrics are healthy", () => {
    expect(classifyProductHealth(healthy())).toBe("green");
  });

  test("red takes priority over yellow", () => {
    expect(
      classifyProductHealth({ totalLeads: 50, marginPct: -5, deliveryRate: 50, returnRate: 30 })
    ).toBe("red");
  });
});
