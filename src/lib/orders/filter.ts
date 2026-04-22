import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignFilterJson, CampaignPreviewSample } from "@/types/follow-up";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

export function applyOrdersFilter(query: QueryBuilder, filter: CampaignFilterJson): QueryBuilder {
  if (filter.statuses && filter.statuses.length > 0) {
    query = query.in("status", filter.statuses);
  }
  if (filter.date_from) {
    query = query.gte("created_at", filter.date_from);
  }
  if (filter.date_to) {
    query = query.lte("created_at", filter.date_to);
  }
  if (filter.city) {
    query = query.eq("customer_city", filter.city);
  }
  if (filter.product_id) {
    query = query.eq("product_id", filter.product_id);
  }
  return query;
}

export interface CampaignPreviewResult {
  matched_count: number;
  skipped_active_followup: number;
  sample: CampaignPreviewSample[];
}

export async function buildCampaignPreview(
  supabase: SupabaseClient,
  marketId: string,
  filter: CampaignFilterJson
): Promise<CampaignPreviewResult> {
  // Total matched orders (count-only query)
  const countBase = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("market_id", marketId);
  const { count: totalMatched } = await applyOrdersFilter(countBase, filter);

  // Orders with an active follow-up in this market (approximate skip count)
  const { count: withActive } = await supabase
    .from("order_follow_ups")
    .select("order_id", { count: "exact", head: true })
    .eq("market_id", marketId)
    .in("status", ["open", "in_progress", "escalated"]);

  // Sample rows (up to 20)
  const sampleBase = supabase
    .from("orders")
    .select("id, customer_name, customer_phone, customer_city, product_id, created_at")
    .eq("market_id", marketId)
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: sampleRows } = await applyOrdersFilter(sampleBase, filter);

  return {
    matched_count: totalMatched ?? 0,
    skipped_active_followup: withActive ?? 0,
    sample: (sampleRows ?? []).map(
      (o: { id: string; customer_name: string; customer_phone: string; customer_city: string | null; product_id: string | null; created_at: string }) => ({
        order_id: o.id,
        customer_name: o.customer_name,
        phone: o.customer_phone,
        city: o.customer_city,
        product_name: o.product_id ?? null,
        created_at: o.created_at,
      })
    ),
  };
}
