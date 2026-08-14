import { describe, expect, it } from "vitest";
import {
  classifyCustomerReliability,
  MIN_ORDERS_FOR_VERDICT,
} from "../customer-reliability";

const stats = (total: number, delivered: number, returned = 0) => ({
  total_orders: total,
  delivered_count: delivered,
  returned_count: returned,
  rejected_count: 0,
  lifetime_value: 0,
});

describe("classifyCustomerReliability — not enough history", () => {
  it("returns unknown below the minimum, because one delivery out of one is not a track record", () => {
    expect(classifyCustomerReliability(stats(1, 1))).toBe("unknown");
    expect(classifyCustomerReliability(stats(2, 2))).toBe("unknown");
  });

  it("starts judging exactly at the minimum", () => {
    expect(MIN_ORDERS_FOR_VERDICT).toBe(3);
    expect(classifyCustomerReliability(stats(3, 3))).toBe("reliable");
  });

  it("returns unknown when there are no stats at all", () => {
    expect(classifyCustomerReliability(null)).toBe("unknown");
    expect(classifyCustomerReliability(stats(0, 0))).toBe("unknown");
  });
});

describe("classifyCustomerReliability — the verdict", () => {
  it("calls a customer reliable at 85% delivered and above", () => {
    expect(classifyCustomerReliability(stats(12, 11, 1))).toBe("reliable");
    expect(classifyCustomerReliability(stats(20, 17, 3))).toBe("reliable");
  });

  it("calls a customer average between 60% and 85%", () => {
    expect(classifyCustomerReliability(stats(12, 9, 3))).toBe("average");
    expect(classifyCustomerReliability(stats(10, 6, 4))).toBe("average");
  });

  it("calls a customer risky below 60%", () => {
    expect(classifyCustomerReliability(stats(10, 5, 5))).toBe("risky");
    expect(classifyCustomerReliability(stats(4, 0, 4))).toBe("risky");
  });

  it("does not let a pending order count against the customer", () => {
    // 3 orders, 2 delivered, 1 still in flight — the rate is measured against
    // orders with an outcome, so this reads as 100% and not as 67%.
    expect(classifyCustomerReliability(stats(3, 2, 0))).toBe("reliable");
  });

  it("never divides by zero when every order is still open", () => {
    expect(classifyCustomerReliability(stats(5, 0, 0))).toBe("unknown");
  });
});
