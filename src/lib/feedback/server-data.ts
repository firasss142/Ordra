import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFamilies, type Family, type FamilyProduct } from "./product-family";
import { isIsoDay } from "./date-range";

/**
 * The market's products as families (sizes folded), in name order so ties always break the
 * same way. Deleted products are left out; inactive ones stay, since old feedback points at
 * them — the caller decides whether an inactive family with nothing to show earns a tab.
 */
export async function loadFamilies(
  supabase: SupabaseClient,
  marketId: string,
): Promise<{ families: Family[]; products: (FamilyProduct & { id: string })[] }> {
  const { data } = await supabase
    .from("products")
    .select("id, name, image_url, is_active")
    .eq("market_id", marketId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  const products = (data ?? []) as FamilyProduct[];
  return { families: buildFamilies(products), products };
}

/** `?from=&to=` as a valid market-day range, or null. Absent dates fall back to the defaults. */
export function readRange(
  params: URLSearchParams,
  fallback: [string, string],
): [string, string] | null {
  const from = params.get("from") ?? fallback[0];
  const to = params.get("to") ?? fallback[1];
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return null;
  return [from, to];
}
