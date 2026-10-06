import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";

/**
 * The online-card surcharge on the product subtotal (see order-total.ts).
 * Was 1.1 written in two places (TypeScript and merge_orders SQL); since
 * 2026-10-06 it is the market's `card_surcharge_pct`, edited in Réglages ›
 * Commandes. Server-side only: an order total is never computed in the browser.
 */
export const DEFAULT_CARD_SURCHARGE_PCT = 10;
const MAX_PCT = 50;

export function parseSurchargePct(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_CARD_SURCHARGE_PCT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_PCT ? n : DEFAULT_CARD_SURCHARGE_PCT;
}

/** Never throws: a total must not fail because a setting could not be read. */
export async function getCardSurchargePct(supabase: SupabaseClient, marketId: string): Promise<number> {
  try {
    const raw = await getMarketSetting(supabase, marketId, "card_surcharge_pct", String(DEFAULT_CARD_SURCHARGE_PCT));
    return parseSurchargePct(raw);
  } catch {
    return DEFAULT_CARD_SURCHARGE_PCT;
  }
}
