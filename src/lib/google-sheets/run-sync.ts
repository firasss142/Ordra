import type { SupabaseClient } from "@supabase/supabase-js";
import { getSheetsSources } from "./sources-config";
import { getLastRowForStorefront, setLastRowForStorefront } from "./sync-state";
import { fetchSheetRows } from "./client";
import { syncOneStorefront, type SyncResult } from "./sync-engine";
import { createOrderFromData } from "@/lib/orders/create-order-from-data";
import type { FetchRowsOptions } from "./types";

/**
 * Runs the Google Sheets sync for a single market.
 * Returns one SyncResult per active sheet source configured for that market.
 */
export async function runSyncForMarket(
  adminClient: SupabaseClient,
  marketId: string
): Promise<SyncResult[]> {
  const sources = await getSheetsSources(adminClient, marketId);
  const results: SyncResult[] = [];

  for (const source of sources) {
    const config = { ...source, market_id: marketId };
    const result = await syncOneStorefront(config, {
      fetchRows: (opts: FetchRowsOptions) => fetchSheetRows(opts),
      processRow: async ({ storefront, orderData, rawRow }) => {
        return createOrderFromData({
          adminClient,
          storefront,
          orderData,
          rawPayload: rawRow.data as Record<string, unknown>,
          sourceNote: "Order received via Google Sheets sync",
        });
      },
      getLastRow: (storefrontId) =>
        getLastRowForStorefront(adminClient, marketId, storefrontId),
      setLastRow: (storefrontId, lastRow) =>
        setLastRowForStorefront(adminClient, marketId, storefrontId, lastRow),
    });
    results.push(result);
  }

  return results;
}
