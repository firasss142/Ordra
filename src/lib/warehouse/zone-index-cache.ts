import type { SupabaseClient } from "@supabase/supabase-js";
import { buildZoneIndex, type BranchRow, type ZoneIndex } from "./zone-index";

/**
 * The Darb branch directory, loaded once per server process.
 *
 * 351 rows that change only when Darb opens or repaints a branch — which is
 * why `probe-darb-branches.ts --sync` is a manual refresh and not a cron. Every
 * queue row needs it, so re-reading it per request would be 351 rows per page
 * of 100 orders for data that is effectively static.
 *
 * The TTL exists so a sync lands without a redeploy, not because the data is
 * volatile. An empty read is NOT cached: that is a transient failure, and
 * caching it would blank the colour column for an hour.
 */

const TTL_MS = 10 * 60 * 1000;

let cached: { index: ZoneIndex; at: number } | null = null;

export async function getZoneIndex(supabase: SupabaseClient): Promise<ZoneIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;

  const { data, error } = await supabase
    .from("darb_branches")
    .select("branch_group, color, city, area");

  if (error || !data || data.length === 0) {
    // Serve a stale index rather than losing every colour on one bad read.
    if (cached) return cached.index;
    return buildZoneIndex([]);
  }

  const index = buildZoneIndex(data as BranchRow[]);
  cached = { index, at: Date.now() };
  return index;
}

/** Test seam: drop the cache so a suite cannot leak an index between cases. */
export function resetZoneIndexCache(): void {
  cached = null;
}
