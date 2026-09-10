import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderLine } from "./summary";

/**
 * Every product line of every parcel on a page, in one query.
 *
 * `orders` carries ONE denormalised product, and every warehouse surface read
 * only that — so a parcel holding three different products showed as one line
 * and the picker packed one item. `order_items` has held the truth since June
 * 2026; this is what puts it in front of the person with the box.
 *
 * Two queries for the whole page, never one per parcel: the lines, then the
 * pictures for the products they name. A parcel that predates `order_items`
 * gets an EMPTY list rather than none, which is how `linesOf` knows to fall
 * back to the denormalised line instead of showing a parcel with no contents.
 */

interface ItemRow {
  order_id: string;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
}

export async function attachOrderLines<T extends { id: string }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<Array<T & { items: OrderLine[] }>> {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const byOrder = new Map<string, OrderLine[]>();

  try {
    const { data } = await supabase
      .from("order_items")
      .select("order_id, product_id, product_name, variant_label, quantity")
      .in("order_id", ids)
      .order("created_at", { ascending: true });

    const items = (data ?? []) as ItemRow[];

    // The picture is per LINE, not per order: a mixed parcel shows one thumb
    // per product, which is the only way to check three items against a box.
    const productIds = Array.from(
      new Set(items.map((i) => i.product_id).filter((id): id is string => Boolean(id))),
    );
    const images = new Map<string, string | null>();
    if (productIds.length > 0) {
      const { data: pics } = await supabase.from("products").select("id, image_url").in("id", productIds);
      for (const p of (pics ?? []) as Array<{ id: string; image_url: string | null }>) {
        images.set(p.id, p.image_url ?? null);
      }
    }

    for (const item of items) {
      const line: OrderLine = {
        product_id: item.product_id,
        product_name: item.product_name,
        variant_label: item.variant_label,
        quantity: item.quantity,
        image_url: item.product_id ? (images.get(item.product_id) ?? null) : null,
      };
      const bucket = byOrder.get(item.order_id);
      if (bucket) bucket.push(line);
      else byOrder.set(item.order_id, [line]);
    }
  } catch {
    // A queue that cannot read its lines still has parcels to scan. Every row
    // falls back to its denormalised line rather than the screen failing.
  }

  return rows.map((r) => ({ ...r, items: byOrder.get(r.id) ?? [] }));
}
