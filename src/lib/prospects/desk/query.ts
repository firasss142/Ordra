/**
 * The list query, shared by the list route and the export so both read the
 * same prospects for the same filters.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { agentOrFilter, combinedOr, DESK_ROW_SELECT, searchOrFilter, sourceOrFilter, stateFilter, type ListQuery } from "./list";

export function deskListQuery(supabase: SupabaseClient, marketId: string, q: ListQuery, opts: { count?: boolean } = {}) {
  let query = supabase.from("leads").select(DESK_ROW_SELECT, opts.count ? { count: "exact" } : undefined).eq("market_id", marketId);
  if (q.id) return query.eq("id", q.id);
  const st = stateFilter(q.state);
  if (st.statusIn) query = query.in("status", st.statusIn);
  if (st.convertedNull) query = query.is("converted_order_id", null);
  const or = combinedOr([st.or ?? null, sourceOrFilter(q.sources), agentOrFilter(q.agents), q.q ? searchOrFilter(q.q) : null]);
  if (or) query = query.or(or);
  // Due callbacks first, then whoever has waited longest.
  return query.order("callback_scheduled_at", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
}
