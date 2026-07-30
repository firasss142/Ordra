import { describe, test, expect } from "vitest";
import { attributeOrderRevenue } from "../order-revenue-attribution";

/**
 * No existing P&L code reads order_items — 100% of orders.total_price is
 * attributed to the single denormalized orders.product_id. On a dashboard that
 * is a rounding issue; when it decides which investor gets paid, it pays the
 * wrong person.
 *
 * total_price also carries the per-order delivery_fee and the Libya card
 * surcharge, so revenue is spread proportionally by line_total rather than
 * summing line totals directly.
 */

describe("attributeOrderRevenue", () => {
  test("gives the whole order to a single-line order", () => {
    const result = attributeOrderRevenue({
      totalPrice: 149,
      lines: [{ productId: "a", lineTotal: 149 }],
    });
    expect(result.get("a")).toBe(149);
  });

  test("splits a two-product order proportionally to line totals", () => {
    const result = attributeOrderRevenue({
      totalPrice: 300,
      lines: [
        { productId: "a", lineTotal: 100 },
        { productId: "b", lineTotal: 200 },
      ],
    });
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(200);
  });

  test("spreads delivery fee and surcharge across lines, not onto one product", () => {
    // Lines total 200, but total_price is 227 (delivery fee + card surcharge).
    // Each product should carry its proportional share of the uplift.
    const result = attributeOrderRevenue({
      totalPrice: 227,
      lines: [
        { productId: "a", lineTotal: 50 },
        { productId: "b", lineTotal: 150 },
      ],
    });

    expect(result.get("a")).toBeCloseTo(56.75, 3);
    expect(result.get("b")).toBeCloseTo(170.25, 3);
    expect((result.get("a") ?? 0) + (result.get("b") ?? 0)).toBe(227);
  });

  test("conserves total_price exactly when it does not divide evenly", () => {
    const result = attributeOrderRevenue({
      totalPrice: 100,
      lines: [
        { productId: "a", lineTotal: 1 },
        { productId: "b", lineTotal: 1 },
        { productId: "c", lineTotal: 1 },
      ],
    });

    const total = [...result.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  test("merges repeated lines for the same product", () => {
    const result = attributeOrderRevenue({
      totalPrice: 300,
      lines: [
        { productId: "a", lineTotal: 100 },
        { productId: "a", lineTotal: 50 },
        { productId: "b", lineTotal: 150 },
      ],
    });

    expect(result.size).toBe(2);
    expect(result.get("a")).toBe(150);
    expect(result.get("b")).toBe(150);
  });

  test("ignores lines with no product, redistributing across the rest", () => {
    const result = attributeOrderRevenue({
      totalPrice: 200,
      lines: [
        { productId: "a", lineTotal: 100 },
        { productId: null, lineTotal: 100 },
      ],
    });

    // The unmapped line cannot be credited to anyone, so the mapped product
    // takes the full order rather than the revenue silently vanishing.
    expect(result.get("a")).toBe(200);
    expect(result.size).toBe(1);
  });

  test("splits equally when every line total is zero", () => {
    const result = attributeOrderRevenue({
      totalPrice: 90,
      lines: [
        { productId: "a", lineTotal: 0 },
        { productId: "b", lineTotal: 0 },
      ],
    });

    expect(result.get("a")).toBe(45);
    expect(result.get("b")).toBe(45);
  });

  test("returns an empty map when there are no usable lines", () => {
    expect(attributeOrderRevenue({ totalPrice: 100, lines: [] }).size).toBe(0);
    expect(
      attributeOrderRevenue({
        totalPrice: 100,
        lines: [{ productId: null, lineTotal: 50 }],
      }).size
    ).toBe(0);
  });

  test("handles a zero-value order", () => {
    const result = attributeOrderRevenue({
      totalPrice: 0,
      lines: [{ productId: "a", lineTotal: 10 }],
    });
    expect(result.get("a")).toBe(0);
  });
});
