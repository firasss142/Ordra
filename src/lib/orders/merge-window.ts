import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { clampWindowHours } from "@/lib/duplicate-orders/window";

/**
 * How far apart two orders may be and still be offered as one parcel.
 *
 * The default is 0 — merging is OFF until a market turns it on. That is not
 * timidity: in Tunisia the same-phone/different-product pairs are eight orders
 * with a median gap of 538 hours, so the affordance would be a foot-gun with no
 * upside. Libya's are 297 pairs at a median of 5.3 hours, which is a real
 * basket split. A market opts in by setting the hours.
 */
export const DEFAULT_MERGE_WINDOW_HOURS = 0;

export async function getMergeWindowHours(
  supabase: SupabaseClient,
  marketId: string,
): Promise<number> {
  const raw = await getMarketSetting(
    supabase,
    marketId,
    "merge_window_hours",
    String(DEFAULT_MERGE_WINDOW_HOURS),
  );
  return clampWindowHours(raw, DEFAULT_MERGE_WINDOW_HOURS);
}
