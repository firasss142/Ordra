import { describe, it, expect } from "vitest";
import { resolveProductDisplayName, unwrapEmbed } from "../display-name";

/**
 * The SSR prefetch in orders/page.tsx and /api/orders/list build their rows
 * with the same two expressions. If they drift, the first paint and the
 * revalidated row disagree and the table visibly changes under the user —
 * which is what the "must stay in sync with LIST_SELECT" comment is guarding.
 */
function mapRow(r: Record<string, unknown>) {
  const { product, ...rest } = r as { product?: unknown } & Record<string, unknown>;
  return {
    ...rest,
    product_display_name: resolveProductDisplayName(r as never),
    product_image_url:
      unwrapEmbed(product as never as { image_url?: string | null } | null)?.image_url ?? null,
  };
}

describe("list row mapping — the thumbnail", () => {
  it("takes image_url from the embedded product (object form)", () => {
    const row = mapRow({
      id: "o1",
      product_name: "external",
      product: { name: "Livre", image_url: "https://x/img.png" },
    });
    expect(row.product_image_url).toBe("https://x/img.png");
    expect(row.product_display_name).toBe("Livre");
  });

  it("takes it from the array form PostgREST sometimes returns", () => {
    const row = mapRow({
      id: "o1",
      product_name: "external",
      product: [{ name: "Livre", image_url: "https://x/img.png" }],
    });
    expect(row.product_image_url).toBe("https://x/img.png");
  });

  it("is null for an order not resolved to a catalog product", () => {
    const row = mapRow({ id: "o1", product_name: "external only", product: null });
    expect(row.product_image_url).toBeNull();
    // The external string still shows, so the row is never blank.
    expect(row.product_display_name).toBe("external only");
  });

  it("is null when the catalog product simply has no picture", () => {
    const row = mapRow({ id: "o1", product_name: "x", product: { name: "Livre" } });
    expect(row.product_image_url).toBeNull();
  });

  it("drops the raw embed so the row shape matches the API's", () => {
    const row = mapRow({ id: "o1", product_name: "x", product: { name: "Livre" } });
    expect(row).not.toHaveProperty("product");
  });
});
