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
  const value = data?.value;
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === "object" && !Array.isArray(value) && "value" in value) {
    const wrapped = (value as { value?: unknown }).value;
    return wrapped === null || wrapped === undefined ? defaultValue : String(wrapped);
  }
  return String(value);
}
