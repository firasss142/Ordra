import { describe, it, expect } from "vitest";
import { deriveDuplicateEnrichment, type RawSibling } from "./detect";

function sibling(o: Partial<RawSibling> = {}): RawSibling {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-05-21T10:00:00Z",
    product_name: "Widget",
    product_image_url: null,
    quantity: 1,
    total_price: 129,
    already_shipped: false,
    ...o,
  };
}

describe("deriveDuplicateEnrichment", () => {
  it("returns the empty enrichment when there are no siblings", () => {
    expect(deriveDuplicateEnrichment([])).toEqual({
      is_potential_duplicate: false,
      duplicate_count: 0,
      duplicate_siblings: [],
      has_uploaded_sibling: false,
      is_duplicate_anchor: false,
    });
  });

  it("flags a potential duplicate with the correct count for one sibling", () => {
    const result = deriveDuplicateEnrichment([sibling()]);
    expect(result.is_potential_duplicate).toBe(true);
    expect(result.duplicate_count).toBe(1);
    expect(result.duplicate_siblings).toHaveLength(1);
  });

  it("counts multiple siblings", () => {
    const result = deriveDuplicateEnrichment([
      sibling({ id: "a", external_id: "EXT-A" }),
      sibling({ id: "b", external_id: "EXT-B" }),
    ]);
    expect(result.duplicate_count).toBe(2);
    expect(result.duplicate_siblings).toHaveLength(2);
  });

  it("sets has_uploaded_sibling only when at least one sibling is already shipped", () => {
    expect(
      deriveDuplicateEnrichment([sibling({ already_shipped: false })])
        .has_uploaded_sibling,
    ).toBe(false);

    expect(
      deriveDuplicateEnrichment([
        sibling({ id: "a", already_shipped: false }),
        sibling({ id: "b", already_shipped: true }),
      ]).has_uploaded_sibling,
    ).toBe(true);
  });

  it("preserves the already_shipped flag per sibling", () => {
    const result = deriveDuplicateEnrichment([
      sibling({ id: "a", already_shipped: false }),
      sibling({ id: "b", already_shipped: true }),
    ]);
    expect(result.duplicate_siblings.find((s) => s.id === "a")?.already_shipped).toBe(
      false,
    );
    expect(result.duplicate_siblings.find((s) => s.id === "b")?.already_shipped).toBe(
      true,
    );
  });

  it("passes total_price through on each sibling", () => {
    const result = deriveDuplicateEnrichment([
      sibling({ id: "a", total_price: 129 }),
      sibling({ id: "b", total_price: 258 }),
    ]);
    expect(result.duplicate_siblings.find((s) => s.id === "a")?.total_price).toBe(129);
    expect(result.duplicate_siblings.find((s) => s.id === "b")?.total_price).toBe(258);
  });

  it("tolerates a null or missing siblings array", () => {
    expect(
      deriveDuplicateEnrichment(null as unknown as RawSibling[]),
    ).toEqual({
      is_potential_duplicate: false,
      duplicate_count: 0,
      duplicate_siblings: [],
      has_uploaded_sibling: false,
      is_duplicate_anchor: false,
    });
  });

  describe("is_duplicate_anchor (newest-in-group carries the icon)", () => {
    const OWN = "2026-05-21T10:05:00Z";

    it("is false when there are no siblings", () => {
      expect(deriveDuplicateEnrichment([], OWN).is_duplicate_anchor).toBe(false);
    });

    it("is true when this order is newer than all its siblings", () => {
      const older = sibling({ created_at: "2026-05-21T10:00:00Z" });
      expect(deriveDuplicateEnrichment([older], OWN).is_duplicate_anchor).toBe(true);
    });

    it("is false when any sibling is strictly newer than this order", () => {
      const newer = sibling({ created_at: "2026-05-21T10:10:00Z" });
      expect(deriveDuplicateEnrichment([newer], OWN).is_duplicate_anchor).toBe(false);
    });

    it("is true on an exact created_at tie", () => {
      const tie = sibling({ created_at: OWN });
      expect(deriveDuplicateEnrichment([tie], OWN).is_duplicate_anchor).toBe(true);
    });

    it("is false (conservative) when own created_at is unknown", () => {
      const older = sibling({ created_at: "2026-05-21T10:00:00Z" });
      expect(deriveDuplicateEnrichment([older]).is_duplicate_anchor).toBe(false);
    });
  });
});
