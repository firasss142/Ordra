import type { SupabaseClient } from "@supabase/supabase-js";
import { marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { DEFAULT_ARCHIVE_AFTER_DAYS } from "@/lib/orders/archive-scope";
import type { ListQuery } from "@/lib/orders/list-filters";
import type { ListQueryContext } from "@/lib/orders/list-query";

/**
 * The market's auto-archive delay. 0 or unset means the rule is off; the tabs
 * of Archivées still need a threshold to split « prêtes » from « récentes »,
 * so off reads as the default 30 days.
 */
export async function readArchiveAfterDays(supabase: SupabaseClient, marketId: string | null): Promise<number> {
  if (!marketId) return DEFAULT_ARCHIVE_AFTER_DAYS;
  const raw = Number(await getMarketSetting(supabase, marketId, "auto_archive_after_days", String(DEFAULT_ARCHIVE_AFTER_DAYS)));
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_ARCHIVE_AFTER_DAYS;
}

/**
 * Orders sent to the carrier since the market's midnight — every order with an
 * `uploaded` transition today, whatever it became since (prototype `inTile("up")`).
 * Read from order_history, never from the current status.
 */
export async function readUploadedSince(
  supabase: SupabaseClient,
  marketId: string | null,
  sinceIso: string | null,
): Promise<string[]> {
  if (!sinceIso) return [];
  let q = supabase.from("order_history").select("order_id").eq("status_to", "uploaded").gte("created_at", sinceIso);
  if (marketId) q = q.eq("market_id", marketId);
  const { data } = await q.limit(5000);
  return Array.from(new Set(((data ?? []) as { order_id: string }[]).map((r) => r.order_id)));
}

/** Everything applyOrderListFilters needs beyond the query — read only when the query needs it. */
export async function loadListContext(
  supabase: SupabaseClient,
  q: ListQuery,
  marketId: string | null,
  now = new Date(),
): Promise<ListQueryContext> {
  const todayStartIso = marketDayStartUtc(todayInMarket(marketId, now), marketId);
  const wantsUploads = q.scope !== "archive" && q.preset === "uploaded_today";
  const wantsDays = q.scope === "archive" && q.state !== "deleted";
  const [uploadedTodayIds, archiveAfterDays] = await Promise.all([
    wantsUploads ? readUploadedSince(supabase, marketId, todayStartIso) : Promise.resolve([]),
    wantsDays ? readArchiveAfterDays(supabase, marketId) : Promise.resolve(DEFAULT_ARCHIVE_AFTER_DAYS),
  ]);
  return { marketId, now, todayStartIso, uploadedTodayIds, archiveAfterDays };
}
