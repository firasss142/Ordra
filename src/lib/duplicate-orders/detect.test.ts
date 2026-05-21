import { describe, it, expect } from "vitest";
import { deriveDuplicateEnrichment, type RawSibling } from "./detect";

function sibling(o: Partial<RawSibling> = {}): RawSibling {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-05-21T10:00:00Z",
    product_name: "Widget",
    quantity: 1,
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

  it("tolerates a null or missing siblings array", () => {
    expect(
      deriveDuplicateEnrichment(null as unknown as RawSibling[]),
    ).toEqual({
      is_potential_duplicate: false,
      duplicate_count: 0,
      duplicate_siblings: [],
      has_uploaded_sibling: false,
    });
  });
});
