import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Journaux has no market column on its logs: an order received belongs to the
 * market of its shop, a carrier event to the market whose carriers use that
 * carrier code (Darb Assabil and Dexpress are Libyan, Navex Tunisian).
 */
export async function storefrontIdsOfMarket(supabase: SupabaseClient, marketId: string): Promise<string[]> {
  const { data } = await supabase.from("storefronts").select("id").eq("market_id", marketId);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

export async function carrierCodesOfMarket(supabase: SupabaseClient, marketId: string): Promise<string[]> {
  const { data } = await supabase.from("carriers").select("code").eq("market_id", marketId);
  return Array.from(new Set(((data ?? []) as { code: string }[]).map((r) => r.code)));
}
