import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/types";
import type { CustomerSearchResult } from "@/types/follow-up";
import { FOLLOW_UP_ELIGIBLE_ORDER_STATUSES } from "@/lib/follow-up-permissions";

export interface SearchCustomersParams {
  phone: string;
  role: Role;
  actorId: string;
  actorMarketId: string | null;
  /** Optional explicit market scope (super_admin selecting a market) */
  marketId?: string;
  limit?: number;
}

export const MIN_PHONE_SEARCH_LENGTH = 3;

/**
 * Search orders eligible for follow-up by customer phone prefix.
 *
 * Scope rules:
 *   - super_admin: all markets (optionally filtered by marketId)
 *   - market_manager: own market
 *   - agent: own market AND where they are the confirming agent
 *
 * Only post-confirmation, non-terminal orders are returned.
 * `has_follow_up` is populated so the UI can prevent duplicate follow-ups.
 */
export async function searchCustomersByPhone(
  supabase: SupabaseClient,
  params: SearchCustomersParams
): Promise<CustomerSearchResult[]> {
  const cleaned = params.phone.trim();
  if (cleaned.length < MIN_PHONE_SEARCH_LENGTH) return [];

  const limit = params.limit ?? 20;

  let query = supabase
    .from("orders")
    .select(
      "id, market_id, customer_name, customer_phone, customer_city, total_price, status"
    )
    .ilike("customer_phone", `%${cleaned}%`)
    .in(
      "status",
      FOLLOW_UP_ELIGIBLE_ORDER_STATUSES as unknown as string[]
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  // Market scope
  if (params.role === "super_admin") {
    if (params.marketId) query = query.eq("market_id", params.marketId);
  } else {
    if (!params.actorMarketId) return [];
    query = query.eq("market_id", params.actorMarketId);
  }

  // Agent extra scope: only orders they confirmed (latest confirmed transition by them)
  // RLS on orders already restricts to assigned agents; we further narrow to "I confirmed it"
  // by joining the result set against their confirmations below.
  const { data, error } = await query;
  if (error) throw new Error((error as { message: string }).message);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  let eligibleOrderIds = rows.map((r) => r.id as string);

  if (params.role === "agent") {
    const { data: confirmations, error: confErr } = await supabase
      .from("order_history")
      .select("order_id")
      .in("order_id", eligibleOrderIds)
      .eq("status_to", "confirmed")
      .eq("actor_type", "agent")
      .eq("actor_id", params.actorId);

    if (confErr) throw new Error((confErr as { message: string }).message);

    const confirmedSet = new Set(
      (confirmations ?? []).map((c) => c.order_id as string)
    );
    eligibleOrderIds = eligibleOrderIds.filter((id) => confirmedSet.has(id));
    if (eligibleOrderIds.length === 0) return [];
  }

  // has_follow_up check
  const { data: existing, error: existErr } = await supabase
    .from("order_follow_ups")
    .select("order_id")
    .in("order_id", eligibleOrderIds);

  if (existErr) throw new Error((existErr as { message: string }).message);
  const hasFollowUpSet = new Set(
    (existing ?? []).map((f) => f.order_id as string)
  );

  return rows
    .filter((r) => eligibleOrderIds.includes(r.id as string))
    .map((r) => ({
      order_id: r.id as string,
      customer_name: r.customer_name as string,
      customer_phone: r.customer_phone as string,
      customer_city: (r.customer_city as string | null) ?? null,
      total_price: Number(r.total_price),
      status: r.status as string,
      has_follow_up: hasFollowUpSet.has(r.id as string),
    }));
}
