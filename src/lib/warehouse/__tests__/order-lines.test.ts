import { describe, it, expect, vi } from "vitest";
import { attachOrderLines } from "../order-lines";

/**
 * The lines of every parcel on a page, in one query.
 *
 * Until now every warehouse surface read the ONE denormalised product on
 * `orders`, so a three-product parcel showed as one line and the picker packed
 * one item. `order_items` has the truth; this puts it on the row without a
 * request per parcel.
 */

interface ItemRow {
  order_id: string;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
}

function client(items: ItemRow[], images: Array<{ id: string; image_url: string | null }> = []) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    // fetchAllRows pages with .range(); the first page returns everything and
    // the second must come back empty or the loop never ends.
    let page = 0;
    chain.range = vi.fn(() => {
      const rows = page === 0 ? items : [];
      page += 1;
      return Promise.resolve({ data: rows, error: null });
    });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "order_items" ? items : images, error: null }).then(resolve);
    return chain;
  });
  return { supabase: { from } as never, from, calls };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  product_id: "p1",
  product_name: "Dumbbell",
  variant_label: null,
  quantity: 1,
  product_image_url: null,
  ...over,
});

describe("attachOrderLines", () => {
  it("puts every line of a parcel on its row", async () => {
    const { supabase } = client([
      { order_id: "o1", product_id: "p1", product_name: "Dumbbell", variant_label: "5 kg", quantity: 2 },
      { order_id: "o1", product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1 },
      { order_id: "o2", product_id: "p3", product_name: "Livre", variant_label: null, quantity: 1 },
    ]);
    const rows = await attachOrderLines(supabase, [row("o1"), row("o2")]);
    expect(rows[0].items?.map((l) => `${l.product_name}×${l.quantity}`)).toEqual(["Dumbbell×2", "Corde×1"]);
    expect(rows[1].items?.map((l) => l.product_name)).toEqual(["Livre"]);
  });

  it("asks once for the whole page, never once per parcel", async () => {
    const { supabase, from } = client([]);
    await attachOrderLines(supabase, [row("o1"), row("o2"), row("o3")]);
    expect(from.mock.calls.filter((c) => c[0] === "order_items")).toHaveLength(1);
  });

  it("pages past PostgREST's row cap instead of losing the last parcels", async () => {
    // 200 parcels averaging six lines each blows through the 1000-row cap, and
    // a truncated order falls back to its single denormalised line — the exact
    // bug this module exists to prevent, appearing only on the busiest days.
    const many: ItemRow[] = [];
    for (let i = 0; i < 1200; i += 1) {
      many.push({ order_id: `o${i % 200}`, product_id: `p${i}`, product_name: `P${i}`, variant_label: null, quantity: 1 });
    }
    const { supabase, from } = client(many);
    const rows = await attachOrderLines(supabase, Array.from({ length: 200 }, (_, i) => row(`o${i}`)));
    const total = rows.reduce((n, r) => n + (r.items?.length ?? 0), 0);
    expect(total).toBe(1200);
    expect(from.mock.calls.filter((c) => c[0] === "order_items")).toHaveLength(1);
  });

  it("leaves an order with no item rows on its denormalised line", async () => {
    const { supabase } = client([]);
    const rows = await attachOrderLines(supabase, [row("o1", { product_name: "Livre", quantity: 3 })]);
    // Empty, not absent: the caller reads "this order predates order_items".
    expect(rows[0].items).toEqual([]);
  });

  it("carries each line's own product picture, not the order's", async () => {
    const { supabase } = client(
      [
        { order_id: "o1", product_id: "p1", product_name: "Dumbbell", variant_label: null, quantity: 1 },
        { order_id: "o1", product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1 },
      ],
      [
        { id: "p1", image_url: "https://img/p1.png" },
        { id: "p2", image_url: "https://img/p2.png" },
      ],
    );
    const rows = await attachOrderLines(supabase, [row("o1")]);
    expect(rows[0].items?.map((l) => l.image_url)).toEqual(["https://img/p1.png", "https://img/p2.png"]);
  });

  it("does not query at all for an empty page", async () => {
    const { supabase, from } = client([]);
    const rows = await attachOrderLines(supabase, []);
    expect(rows).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("still paints the queue when the lines cannot be read", async () => {
    const from = vi.fn(() => {
      throw new Error("db down");
    });
    const rows = await attachOrderLines({ from } as never, [row("o1")]);
    // A missing line list is not a missing parcel; the bench must still work.
    expect(rows[0].items).toEqual([]);
  });
});
