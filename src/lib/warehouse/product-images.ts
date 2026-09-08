import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Put the product's picture on a queue row.
 *
 * The queue RPCs (`get_to_label_orders`, `get_to_be_returned_orders`) return
 * order fields only; the picture a picker matches against the box lives on
 * `products.image_url`. One query per page, never one per row. A row whose
 * product has no picture, or no product at all, gets null and the card shows
 * its placeholder.
 */
export async function attachProductImages<T extends { product_id: string | null }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<Array<T & { product_image_url: string | null }>> {
  const ids = Array.from(new Set(rows.map((r) => r.product_id).filter((id): id is string => Boolean(id))));
  const images = new Map<string, string | null>();
  if (ids.length > 0) {
    try {
      const { data } = await supabase.from("products").select("id, image_url").in("id", ids);
      for (const p of (data ?? []) as Array<{ id: string; image_url: string | null }>) {
        images.set(p.id, p.image_url ?? null);
      }
    } catch {
      // A missing picture is not a missing parcel: the queue must still paint.
    }
  }
  return rows.map((r) => ({ ...r, product_image_url: r.product_id ? (images.get(r.product_id) ?? null) : null }));
}
