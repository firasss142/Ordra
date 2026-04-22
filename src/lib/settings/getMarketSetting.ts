import type { SupabaseClient } from "@supabase/supabase-js";

export async function getMarketSetting(
  supabase: SupabaseClient,
  marketId: string,
  key: string,
  defaultValue: string
): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", key)
    .single();
  return data?.value ?? defaultValue;
}
