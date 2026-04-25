import { describe, it, expect } from "vitest";
import { computeFCR } from "./fcr";

describe("computeFCR", () => {
  it("returns 100 when all confirmed orders were confirmed on attempt_1 only", () => {
    const orders = [
      { order_id: "o1", attempts: 1 },
      { order_id: "o2", attempts: 1 },
    ];
    expect(computeFCR(orders)).toBe(100);
  });

  it("returns 50 when half of confirmed orders needed more than one attempt", () => {
    const orders = [
      { order_id: "o1", attempts: 1 },
      { order_id: "o2", attempts: 2 },
    ];
    expect(computeFCR(orders)).toBe(50);
  });

  it("returns 0 when every confirmed order took multiple attempts", () => {
    const orders = [
      { order_id: "o1", attempts: 2 },
      { order_id: "o2", attempts: 3 },
    ];
    expect(computeFCR(orders)).toBe(0);
  });

  it("returns 0 when there are no confirmed orders", () => {
    expect(computeFCR([])).toBe(0);
  });

  it("rounds to one decimal place", () => {
    const orders = [
      { order_id: "o1", attempts: 1 },
      { order_id: "o2", attempts: 1 },
      { order_id: "o3", attempts: 2 },
    ];
    expect(computeFCR(orders)).toBe(66.7);
  });
});
