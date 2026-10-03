import { describe, it, expect } from "vitest";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { countMinutes, eventKey, isLow, lastCountedAt, neverCounted, signed } from "../stock-bits";

const row = (over: Partial<WarehouseStockRow> = {}): WarehouseStockRow => ({
  product_id: "p", name: "p", sku: null, image_url: null, current_stock: 100, low_stock_threshold: 10,
  stock_goal: null, goal_pct: null, damaged_return_count: 0, engaged: 0, free: 100,
  last_counted_at: null, accuracy: null, series: [], sites: [], unallocated: 100, incoming: null, variants: [],
  ...over,
});
const TWO = [{ id: "T", code: "TIP", name: "Tripoli" }, { id: "B", code: "BEN", name: "Benghazi" }];

describe("stock-bits", () => {
  it("prices a first count at about 25 s a product, never under a minute", () => {
    expect(countMinutes(7)).toBe(3);
    expect(countMinutes(1)).toBe(1);
  });

  it("writes a real minus sign", () => {
    expect(signed(-1)).toBe("−1");
    expect(signed(3)).toBe("+3");
    expect(signed(0)).toBe("0");
  });

  it("names a ledger row by its reason, a print or a handover by its stream", () => {
    expect(eventKey({ kind: "scan", reason: "scanned" })).toBe("scanned");
    expect(eventKey({ kind: "handover", reason: null })).toBe("handover");
  });

  it("judges « never counted » at the building in view, else anywhere", () => {
    const counted = row({
      last_counted_at: "2026-10-01T09:00:00Z",
      sites: [{ warehouse_id: "T", code: "TIP", name: "Tripoli", current_stock: 5, last_counted_at: "2026-10-01T09:00:00Z" }],
    });
    expect(neverCounted(counted, null, TWO)).toBe(false);
    expect(neverCounted(counted, "B", TWO)).toBe(true);
    expect(lastCountedAt(counted, "T", TWO)).toBe("2026-10-01T09:00:00Z");
  });

  it("calls a product low when its FREE stock is at or under the threshold", () => {
    expect(isLow(row({ free: 10 }))).toBe(true);
    expect(isLow(row({ free: 11 }))).toBe(false);
  });
});
