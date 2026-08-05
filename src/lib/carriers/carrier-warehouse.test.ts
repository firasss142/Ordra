import { describe, test, expect } from "vitest";
import {
  resolveWarehouseLines,
  checkWarehouseStock,
  availableFor,
  effectiveOrderLines,
  type CarrierProductMapping,
  type CarrierStockRow,
} from "./carrier-warehouse";
import type { OrderItem } from "@/types/order-items";

const WAREHOUSE = "68a079176ddfe500994eea7e";

const mapping = (over: Partial<CarrierProductMapping> = {}): CarrierProductMapping => ({
  product_id: "prod-small",
  product_variant_id: null,
  external_product_id: "6a4cf251a17046128d971c0b",
  external_variant_id: "6a4cf251a17046128d971c08",
  external_sku: "دميه ملاكمه حجم صغير",
  external_warehouse_id: WAREHOUSE,
  external_sale_price: 129,
  ...over,
});

const item = (over: Partial<OrderItem> = {}): OrderItem => ({
  id: "i1",
  order_id: "o1",
  product_id: "prod-small",
  product_name: "دميه ملاكمه حجم صغير",
  variant_id: null,
  variant_label: null,
  quantity: 1,
  unit_price: 129,
  line_total: 129,
  created_at: "",
  updated_at: "",
  ...over,
});

const stockRow = (over: Partial<CarrierStockRow> = {}): CarrierStockRow => ({
  warehouse: WAREHOUSE,
  product: "6a4cf251a17046128d971c0b",
  variant: "6a4cf251a17046128d971c08",
  quantity: 84,
  lockedQuantity: 0,
  ...over,
});

describe("resolveWarehouseLines", () => {
  test("maps each order line to its carrier-side identity, in line order", () => {
    const result = resolveWarehouseLines(
      [
        mapping(),
        mapping({
          product_id: "prod-big",
          external_product_id: "6a4cf66839eb7296f4175151",
          external_variant_id: "6a4cf66839eb7296f417514e",
          external_sku: "دميه ملاكمه حجم كبير",
          external_sale_price: 199,
        }),
      ],
      [item(), item({ id: "i2", product_id: "prod-big" })]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warehouseId).toBe(WAREHOUSE);
    expect(result.lines.map((l) => l.external_product_id)).toEqual([
      "6a4cf251a17046128d971c0b",
      "6a4cf66839eb7296f4175151",
    ]);
  });

  test("prefers an exact variant mapping over the product-level fallback", () => {
    const result = resolveWarehouseLines(
      [
        mapping({ external_product_id: "product-level" }),
        mapping({
          product_variant_id: "var-1",
          external_product_id: "variant-level",
        }),
      ],
      [item({ variant_id: "var-1" })]
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].external_product_id).toBe("variant-level");
  });

  test("fails, naming the products, when a line has no mapping", () => {
    const result = resolveWarehouseLines(
      [mapping()],
      [item(), item({ id: "i2", product_id: "unmapped", product_name: "كتاب" })]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("كتاب");
  });

  test("fails when the order has no line items", () => {
    expect(resolveWarehouseLines([mapping()], []).ok).toBe(false);
  });

  test("fails when lines span more than one carrier warehouse", () => {
    const result = resolveWarehouseLines(
      [
        mapping(),
        mapping({
          product_id: "prod-other",
          external_warehouse_id: "another-warehouse",
        }),
      ],
      [item(), item({ id: "i2", product_id: "prod-other" })]
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("entrepôts");
  });
});

// Most legacy orders predate order_items and carry only a header product
// (orders.product_id + quantity + total_price). Warehouse mode still has to
// reference a carrier product per line, so the header becomes one synthetic line.
describe("effectiveOrderLines", () => {
  const header = {
    product_id: "prod-small",
    product_name: "دميه ملاكمه حجم صغير",
    variant_label: null,
    quantity: 1,
    total_price: 129,
  };

  test("returns real order_items untouched when present", () => {
    const items = [item()];
    expect(effectiveOrderLines(items, header)).toBe(items);
  });

  test("synthesizes one line from the header when order_items is empty", () => {
    const lines = effectiveOrderLines([], header);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      product_id: "prod-small",
      product_name: "دميه ملاكمه حجم صغير",
      variant_id: null,
      quantity: 1,
      unit_price: 129,
    });
  });

  test("derives unit_price from total_price so COD stays exact", () => {
    // 3 units at 537 total → 179 each; quantity must stay 3 so the carrier
    // deducts three units of stock, not one.
    const lines = effectiveOrderLines([], {
      ...header,
      quantity: 3,
      total_price: 537,
    });
    expect(lines[0].quantity).toBe(3);
    expect(lines[0].unit_price).toBe(179);
    expect(lines[0].unit_price * lines[0].quantity).toBe(537);
  });

  test("returns [] when the header has no product_id — nothing to map", () => {
    expect(effectiveOrderLines([], { ...header, product_id: null })).toEqual([]);
  });
});

describe("availableFor", () => {
  test("subtracts locked units — they are committed to other shipments", () => {
    expect(
      availableFor(
        [stockRow({ quantity: 10, lockedQuantity: 4 })],
        "6a4cf251a17046128d971c0b",
        "6a4cf251a17046128d971c08"
      )
    ).toBe(6);
  });

  test("returns 0 for a product the carrier does not hold", () => {
    expect(availableFor([stockRow()], "nope", "nope")).toBe(0);
  });

  test("never returns a negative when locked exceeds quantity", () => {
    expect(
      availableFor(
        [stockRow({ quantity: 2, lockedQuantity: 5 })],
        "6a4cf251a17046128d971c0b",
        "6a4cf251a17046128d971c08"
      )
    ).toBe(0);
  });
});

describe("checkWarehouseStock", () => {
  const lines = [
    {
      external_product_id: "6a4cf251a17046128d971c0b",
      external_variant_id: "6a4cf251a17046128d971c08",
      external_sku: "دميه ملاكمه حجم صغير",
      external_sale_price: 129,
    },
  ];

  test("passes when the carrier holds enough", () => {
    expect(checkWarehouseStock(lines, [item({ quantity: 3 })], [stockRow()]).ok).toBe(
      true
    );
  });

  test("fails when the carrier is short, reporting wanted vs available", () => {
    const result = checkWarehouseStock(
      lines,
      [item({ quantity: 5 })],
      [stockRow({ quantity: 6, lockedQuantity: 4 })]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("demandé 5");
    expect(result.error).toContain("disponible 2");
  });

  test("aggregates quantity across repeated lines of the same product", () => {
    // Two lines of 3 against 5 available must fail, even though each line fits.
    const result = checkWarehouseStock(
      [lines[0], lines[0]],
      [item({ quantity: 3 }), item({ id: "i2", quantity: 3 })],
      [stockRow({ quantity: 5, lockedQuantity: 0 })]
    );
    expect(result.ok).toBe(false);
  });

  test("fails when the carrier reports no stock row at all", () => {
    expect(checkWarehouseStock(lines, [item()], []).ok).toBe(false);
  });
});
