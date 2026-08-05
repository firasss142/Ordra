import { describe, it, expect } from "vitest";
import { stockBadge } from "@/lib/products/stock-badge";

describe("stockBadge", () => {
  it("is critical at zero", () => {
    expect(stockBadge(0)).toEqual({ tone: "critical", key: "outOfStock" });
  });

  it("is critical when negative", () => {
    expect(stockBadge(-2).tone).toBe("critical");
  });

  it("warns at or below the threshold and carries the count", () => {
    expect(stockBadge(5)).toEqual({ tone: "warning", key: "stockLeft", count: 5 });
    expect(stockBadge(1).count).toBe(1);
  });

  it("is success above the threshold", () => {
    expect(stockBadge(6)).toEqual({ tone: "success", key: "inStock" });
  });

  it("honours an explicit threshold", () => {
    expect(stockBadge(8, 10).key).toBe("stockLeft");
    expect(stockBadge(11, 10).key).toBe("inStock");
  });

  it("reproduces the behaviour the two original call sites hardcoded", () => {
    // OrderItemsCard / AddProductPicker: <=0 critical, <=5 warning, else success.
    expect(stockBadge(10).key).toBe("inStock");
    expect(stockBadge(5).key).toBe("stockLeft");
    expect(stockBadge(0).key).toBe("outOfStock");
  });
});
