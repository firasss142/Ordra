/**
 * « Sync now » for the lists a caller may see — so an agent holding the driver's
 * sheet does not wait for the 10-minute poll (docs/xdelivery-manifests.md).
 *
 * Carrier-agnostic entry point: X-Delivery is the only source today. Another
 * Tunisian carrier plugs in here with its own sync, the routes do not change.
 * Service role: the caller's scope (market, building) was decided by the route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildManifestSyncDeps, loadXDeliveryPortalAccounts } from "@/lib/carriers/xdelivery/production";
import { syncXDeliveryManifests, type ManifestSyncResult } from "@/lib/carriers/xdelivery/manifest-sync";

export async function refreshManifestsFor(
  admin: SupabaseClient,
  scope: { marketId: string; warehouseId: string | null },
): Promise<ManifestSyncResult> {
  const carrierIds = (await loadXDeliveryPortalAccounts(admin))
    .filter(
      (a) =>
        a.marketId === scope.marketId &&
        (scope.warehouseId === null || a.warehouseId === null || a.warehouseId === scope.warehouseId),
    )
    .map((a) => a.carrierId);
  if (carrierIds.length === 0) return { accounts: 0, lists: 0, released: 0, errors: 0 };
  return syncXDeliveryManifests(buildManifestSyncDeps(admin, carrierIds));
}
