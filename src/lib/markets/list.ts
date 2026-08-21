import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

export interface MarketRow {
  id: string;
  name: string;
  code: string;
  language?: string;
  currency?: string;
  direction?: string;
  is_active?: boolean;
}

export const getAllActiveMarkets = unstable_cache(
  async (): Promise<MarketRow[]> => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("markets")
      .select("id, name, code, language, currency, direction, is_active")
      .eq("is_active", true)
      .order("name");
    return (data ?? []) as MarketRow[];
  },
  ["markets:active"],
  { revalidate: 60, tags: ["markets"] },
);

export async function listMarketsFor(
  role: string,
  marketId: string | null,
): Promise<MarketRow[]> {
  const all = await getAllActiveMarkets();
  if (role === "super_admin" || !marketId) return all;
  return all.filter((m) => m.id === marketId);
}

/** Tunisia is the primary market; fall back to the first active market. */
export function getDefaultMarketId(markets: MarketRow[]): string {
  return (markets.find((m) => m.code === "tn") ?? markets[0])?.id ?? "";
}
