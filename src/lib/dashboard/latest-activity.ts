import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";

// Statuses that the dashboard KPIs and P&L actually aggregate (revenue, costs,
// confirmation funnel). We anchor the default period to the latest of THESE
// events — not any order_history row — so the financial views land on a date
// with real numbers. A market can have recent pending/attempt churn but no
// recent delivered/confirmed events; anchoring to that churn would still show
// zero revenue. Keep this list in sync with the metrics that gate on status.
export const REVENUE_RELEVANT_STATUSES = [
  "delivered",
  "returned",
  "confirmed",
] as const;

// Returns the ISO date (YYYY-MM-DD) of the most recent revenue-relevant
// order_history event for a market, or null if the market has none. For "all" /
// null (super_admin cross-market), returns the global max across every market.
//
// Reads order_history.market_id directly (denormalized by 20260819000001) — an
// earlier version joined orders!inner(market_id) because the column did not yet
// exist. The join forced a row from orders per candidate before the LIMIT 1
// could apply; filtering locally lets
// idx_order_history_market_status_created serve the ordering outright.
export async function getLatestActivityDate(
  supabase: SupabaseClient,
  marketId: string | "all" | null,
): Promise<string | null> {
  let query = supabase
    .from("order_history")
    .select("created_at")
    .in("status_to", REVENUE_RELEVANT_STATUSES as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1);

  if (marketId && marketId !== "all") {
    query = query.eq("market_id", marketId);
  }

  const { data, error } = (await query) as {
    data: Array<{ created_at: string }> | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

  const created = data?.[0]?.created_at;
  return created ? created.slice(0, 10) : null;
}

// Cached wrapper for request paths (SSR page + API route). The latest activity
// date changes at most once per day, and the underlying join+order query is
// relatively expensive, so we memoize per market to avoid re-running it on every
// request (and to avoid a concurrent burst exhausting the statement timeout).
// Uses the admin client (RLS-independent) — the caller has already role-gated,
// and the result is just a single date scoped to the requested market.
export function getLatestActivityDateCached(
  marketId: string | "all" | null,
): Promise<string | null> {
  const key = marketId ?? "all";
  const cached = unstable_cache(
    () => getLatestActivityDate(createAdminClient() as unknown as SupabaseClient, marketId),
    ["latest-activity", key],
    { revalidate: 300, tags: ["order_history"] },
  );
  return cached();
}
