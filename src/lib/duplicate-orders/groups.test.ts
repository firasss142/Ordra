import { describe, it, expect } from "vitest";
import {
  deriveGroupConfidence,
  deriveGroupSelection,
  DUPLICATE_GROUP_DELETABLE_STATUSES,
  type DuplicateGroupMember,
} from "./groups";
import { DUPLICATE_DIALOG_DELETE_STATUSES } from "@/lib/order-permissions";

function member(o: Partial<DuplicateGroupMember> = {}): DuplicateGroupMember {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-09-17T10:00:00Z",
    product_id: "p-1",
    product_name: "Widget",
    product_image_url: null,
    quantity: 1,
    unit_price: 100,
    total_price: 129,
    customer_name: "Ahmed",
    customer_address: "12 Rue X",
    customer_city: "Tripoli",
    already_shipped: false,
    is_anchor: false,
    deletable: true,
    ...o,
  };
}

describe("DUPLICATE_GROUP_DELETABLE_STATUSES", () => {
  /**
   * The SQL side computes `deletable` independently. If the two lists ever
   * drift, the screen offers a checkbox the delete path then refuses — or, far
   * worse, hides one it would have accepted. This test is the guard.
   */
  it("matches DUPLICATE_DIALOG_DELETE_STATUSES exactly", () => {
    expect([...DUPLICATE_GROUP_DELETABLE_STATUSES].sort()).toEqual(
      [...DUPLICATE_DIALOG_DELETE_STATUSES].sort(),
    );
  });

  it("never contains a carrier-committed or stock-deducted status", () => {
    for (const s of ["uploaded", "scanned", "dispatched", "delivered", "in_transit"]) {
      expect(DUPLICATE_GROUP_DELETABLE_STATUSES.has(s as never)).toBe(false);
    }
  });
});

describe("deriveGroupConfidence", () => {
  const anchor = member({ id: "a", created_at: "2026-09-17T10:00:00Z" });

  it("is high when product, quantity and price match within the autoselect window", () => {
    const other = member({ id: "b", created_at: "2026-09-17T10:20:00Z" });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("high");
  });

  it("is review when the gap exceeds the autoselect window", () => {
    // Tunisia's real pattern: same product, days apart, both delivered. A
    // genuine re-order of a consumable must never arrive pre-ticked.
    const other = member({ id: "b", created_at: "2026-09-22T10:00:00Z" });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("review");
  });

  it("is review when the quantity differs", () => {
    const other = member({ id: "b", created_at: "2026-09-17T10:20:00Z", quantity: 2 });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("review");
  });

  it("is review when the price differs", () => {
    const other = member({ id: "b", created_at: "2026-09-17T10:20:00Z", total_price: 258 });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("review");
  });

  it("is review when any member is already shipped, however close in time", () => {
    // 60 Libyan orders a 1h rule would flag are already uploaded/scanned/
    // delivered. A real parcel must never be pre-ticked for deletion.
    const other = member({
      id: "b",
      created_at: "2026-09-17T10:05:00Z",
      already_shipped: true,
      status: "uploaded",
      deletable: false,
    });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("review");
  });

  it("is review when the members have different delivery addresses", () => {
    // Same phone is not the same destination: over half of the different-product
    // pairs measured had a different address. Keep the human in the loop.
    const other = member({
      id: "b",
      created_at: "2026-09-17T10:20:00Z",
      customer_address: "99 Avenue Y",
    });
    expect(deriveGroupConfidence([anchor, other], 1)).toBe("review");
  });

  it("is review when the autoselect window is 0, which disables pre-selection", () => {
    const other = member({ id: "b", created_at: "2026-09-17T10:01:00Z" });
    expect(deriveGroupConfidence([anchor, other], 0)).toBe("review");
  });
});

describe("deriveGroupSelection", () => {
  const anchor = member({ id: "a", is_anchor: true, created_at: "2026-09-17T10:20:00Z" });
  const older = member({ id: "b", created_at: "2026-09-17T10:00:00Z" });

  it("never selects the anchor — it is the order being kept", () => {
    const selected = deriveGroupSelection([anchor, older], "high");
    expect(selected).not.toContain("a");
  });

  it("pre-selects the non-anchor members of a high-confidence group", () => {
    expect(deriveGroupSelection([anchor, older], "high")).toEqual(["b"]);
  });

  it("selects nothing in a review group, whatever its members", () => {
    expect(deriveGroupSelection([anchor, older], "review")).toEqual([]);
  });

  it("never selects a member that is not deletable", () => {
    const committed = member({ id: "c", status: "uploaded", deletable: false });
    expect(deriveGroupSelection([anchor, older, committed], "high")).toEqual(["b"]);
  });

  it("never selects an already-shipped member", () => {
    const shipped = member({ id: "d", already_shipped: true, deletable: true });
    expect(deriveGroupSelection([anchor, older, shipped], "high")).toEqual(["b"]);
  });
});
