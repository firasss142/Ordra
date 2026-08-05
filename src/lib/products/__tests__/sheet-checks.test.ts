import { describe, it, expect } from "vitest";
import {
  checkProductSheet,
  type SheetCheckOrder,
  type SheetCheckProduct,
  type SheetCheckVariant,
} from "@/lib/products/sheet-checks";

function order(overrides: Partial<SheetCheckOrder> = {}): SheetCheckOrder {
  return { product_id: "p-1", variant_id: null, unit_price: 49, ...overrides };
}

function product(overrides: Partial<SheetCheckProduct> = {}): SheetCheckProduct {
  return {
    id: "p-1",
    is_active: true,
    current_stock: 40,
    low_stock_threshold: 10,
    default_price: 49,
    ...overrides,
  };
}

function variant(overrides: Partial<SheetCheckVariant> = {}): SheetCheckVariant {
  return { id: "v-1", label: "1 pc", display_price: 49, is_active: true, ...overrides };
}

const codes = (checks: { code: string }[]) => checks.map((c) => c.code);

describe("checkProductSheet — unmapped", () => {
  it("returns only 'unmapped' when the order has no catalogue product", () => {
    const result = checkProductSheet(order({ product_id: null }), null, []);
    expect(codes(result)).toEqual(["unmapped"]);
  });

  it("flags unmapped when product_id is set but the product could not be loaded", () => {
    const result = checkProductSheet(order(), null, []);
    expect(codes(result)).toEqual(["unmapped"]);
  });

  it("does not attempt a price check when unmapped (nothing to compare against)", () => {
    const result = checkProductSheet(order({ unit_price: 999 }), null, []);
    expect(codes(result)).not.toContain("price_mismatch");
  });
});

describe("checkProductSheet — stock", () => {
  it("flags out_of_stock as critical at zero", () => {
    const result = checkProductSheet(order(), product({ current_stock: 0 }), []);
    expect(result.find((c) => c.code === "out_of_stock")?.severity).toBe("critical");
  });

  it("flags out_of_stock when stock is negative", () => {
    const result = checkProductSheet(order(), product({ current_stock: -3 }), []);
    expect(codes(result)).toContain("out_of_stock");
  });

  it("flags low_stock as warning at or below the threshold", () => {
    const result = checkProductSheet(
      order(),
      product({ current_stock: 10, low_stock_threshold: 10 }),
      [],
    );
    expect(result.find((c) => c.code === "low_stock")?.severity).toBe("warning");
  });

  it("does not flag low_stock above the threshold", () => {
    const result = checkProductSheet(
      order(),
      product({ current_stock: 11, low_stock_threshold: 10 }),
      [],
    );
    expect(codes(result)).not.toContain("low_stock");
  });

  it("never reports out_of_stock and low_stock together", () => {
    const result = checkProductSheet(order(), product({ current_stock: 0 }), []);
    expect(codes(result)).toContain("out_of_stock");
    expect(codes(result)).not.toContain("low_stock");
  });

  it("carries the remaining count so the UI can render it", () => {
    const result = checkProductSheet(order(), product({ current_stock: 4 }), []);
    expect(result.find((c) => c.code === "low_stock")?.values).toMatchObject({ stock: 4 });
  });
});

describe("checkProductSheet — product/variant activation", () => {
  it("flags product_inactive as critical", () => {
    const result = checkProductSheet(order(), product({ is_active: false }), []);
    expect(result.find((c) => c.code === "product_inactive")?.severity).toBe("critical");
  });

  it("flags variant_inactive when the ordered pack tier was deactivated", () => {
    const result = checkProductSheet(
      order({ variant_id: "v-2" }),
      product(),
      [variant(), variant({ id: "v-2", label: "3 pcs", display_price: 99, is_active: false })],
    );
    expect(codes(result)).toContain("variant_inactive");
    expect(result.find((c) => c.code === "variant_inactive")?.values).toMatchObject({
      label: "3 pcs",
    });
  });

  it("does not flag variant_inactive when the ordered variant is active", () => {
    const result = checkProductSheet(order({ variant_id: "v-1" }), product(), [variant()]);
    expect(codes(result)).not.toContain("variant_inactive");
  });

  it("does not flag variant_inactive when the order has no variant", () => {
    const result = checkProductSheet(order(), product(), [variant({ is_active: false })]);
    expect(codes(result)).not.toContain("variant_inactive");
  });
});

describe("checkProductSheet — price", () => {
  it("flags price_mismatch against the catalogue default price", () => {
    const result = checkProductSheet(order({ unit_price: 39 }), product({ default_price: 49 }), []);
    const check = result.find((c) => c.code === "price_mismatch");
    expect(check?.severity).toBe("warning");
    expect(check?.values).toMatchObject({ orderPrice: 39, catalogPrice: 49 });
  });

  it("prefers the ordered variant's display_price over the product default", () => {
    const result = checkProductSheet(
      order({ variant_id: "v-2", unit_price: 49 }),
      product({ default_price: 49 }),
      [variant(), variant({ id: "v-2", label: "3 pcs", display_price: 99 })],
    );
    const check = result.find((c) => c.code === "price_mismatch");
    expect(check?.values).toMatchObject({ orderPrice: 49, catalogPrice: 99 });
  });

  it("does not flag a match", () => {
    const result = checkProductSheet(order({ unit_price: 49 }), product({ default_price: 49 }), []);
    expect(codes(result)).not.toContain("price_mismatch");
  });

  it("tolerates NUMERIC(10,3) float noise", () => {
    const result = checkProductSheet(
      order({ unit_price: 49.0001 }),
      product({ default_price: 49 }),
      [],
    );
    expect(codes(result)).not.toContain("price_mismatch");
  });

  it("skips the price check when the catalogue has no price to compare", () => {
    const result = checkProductSheet(order({ unit_price: 49 }), product({ default_price: null }), []);
    expect(codes(result)).not.toContain("price_mismatch");
  });

  it("skips the price check when the catalogue price is zero (unset, not free)", () => {
    const result = checkProductSheet(order({ unit_price: 49 }), product({ default_price: 0 }), []);
    expect(codes(result)).not.toContain("price_mismatch");
  });

  it("falls back to the default price when the ordered variant is missing from the catalogue", () => {
    const result = checkProductSheet(
      order({ variant_id: "gone", unit_price: 39 }),
      product({ default_price: 49 }),
      [variant()],
    );
    expect(result.find((c) => c.code === "price_mismatch")?.values).toMatchObject({
      catalogPrice: 49,
    });
  });
});

describe("checkProductSheet — cross-sell preview (compareToOrder: false)", () => {
  it("keeps intrinsic problems, which still matter for the alternative", () => {
    const result = checkProductSheet(
      order(),
      product({ is_active: false, current_stock: 0 }),
      [],
      { compareToOrder: false },
    );
    expect(codes(result).sort()).toEqual(["out_of_stock", "product_inactive"]);
  });

  it("drops the price comparison — the order's price is for a different product", () => {
    const result = checkProductSheet(
      order({ unit_price: 39 }),
      product({ default_price: 99 }),
      [],
      { compareToOrder: false },
    );
    expect(codes(result)).not.toContain("price_mismatch");
  });

  it("drops the variant check for the same reason", () => {
    const result = checkProductSheet(
      order({ variant_id: "v-2" }),
      product(),
      [variant({ id: "v-2", label: "3 pcs", is_active: false })],
      { compareToOrder: false },
    );
    expect(codes(result)).not.toContain("variant_inactive");
  });

  it("still compares to the order by default", () => {
    const result = checkProductSheet(order({ unit_price: 39 }), product({ default_price: 49 }), []);
    expect(codes(result)).toContain("price_mismatch");
  });
});

describe("checkProductSheet — ordering and cleanliness", () => {
  it("returns an empty list for a healthy order", () => {
    const result = checkProductSheet(order({ variant_id: "v-1" }), product(), [variant()]);
    expect(result).toEqual([]);
  });

  it("sorts critical before warning so the banner can take the first entry", () => {
    const result = checkProductSheet(
      order({ unit_price: 39 }),
      product({ current_stock: 0, default_price: 49 }),
      [],
    );
    expect(result[0].severity).toBe("critical");
    expect(result.map((c) => c.severity)).toEqual(
      [...result.map((c) => c.severity)].sort(
        (a, b) =>
          ["critical", "warning", "info"].indexOf(a) - ["critical", "warning", "info"].indexOf(b),
      ),
    );
  });

  it("reports every independent problem at once", () => {
    const result = checkProductSheet(
      order({ variant_id: "v-2", unit_price: 39 }),
      product({ is_active: false, current_stock: 0, default_price: 49 }),
      [variant({ id: "v-2", label: "3 pcs", display_price: 99, is_active: false })],
    );
    expect(codes(result).sort()).toEqual(
      ["out_of_stock", "price_mismatch", "product_inactive", "variant_inactive"].sort(),
    );
  });
});
