import { describe, it, expect, vi } from "vitest";
import { attachProductImages } from "../product-images";

/**
 * The queue RPCs return order fields only; the picture the picker matches
 * against the shelf lives on the product. One query per page, never one per
 * row, and a row whose product has no picture (or no product) stays null.
 */
function client(products: Array<{ id: string; image_url: string | null }>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: products, error: null }).then(resolve);
  const from = vi.fn().mockReturnValue(chain);
  return { supabase: { from } as never, from, chain };
}

describe("attachProductImages", () => {
  it("stamps each row with its product's picture, in one query", async () => {
    const { supabase, from, chain } = client([{ id: "p1", image_url: "https://img/p1.png" }, { id: "p2", image_url: null }]);
    const rows = await attachProductImages(supabase, [
      { id: "o1", product_id: "p1" },
      { id: "o2", product_id: "p2" },
      { id: "o3", product_id: "p1" },
    ]);
    expect(rows.map((r) => r.product_image_url)).toEqual(["https://img/p1.png", null, "https://img/p1.png"]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("products");
    expect((chain.in as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(["p1", "p2"]);
  });

  it("asks nothing when no row has a product, and never throws", async () => {
    const { supabase, from } = client([]);
    const rows = await attachProductImages(supabase, [{ id: "o1", product_id: null }]);
    expect(rows[0].product_image_url).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });
});
