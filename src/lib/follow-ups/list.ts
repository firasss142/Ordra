import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpStatus, OrderFollowUpWithOrder } from "@/types/follow-up";
import { FOLLOW_UP_STATUSES } from "@/types/follow-up";

export const FOLLOW_UPS_LIST_SELECT = `
  id, market_id, order_id, status, campaign_id, delivery_man_phone, description,
  confirming_agent_id, updated_at, created_at,
  order:orders!inner (
    id, customer_name, customer_phone, customer_city, total_price, status, assigned_to
  ),
  campaign:follow_up_campaigns (
    id, name
  )
`;

export interface FollowUpsCursor {
  updatedAt: string;
  id: string;
}

export interface FollowUpsListFilters {
  /** null = all markets (super_admin). */
  marketId: string | null;
  status?: FollowUpStatus;
  agentId?: string | null;
  campaignId?: string | null;
  /** Opaque base64url cursor from the previous page's nextCursor. */
  cursor?: string | null;
  /** Rows per page. Defaults to 25. */
  limit?: number;
}

export interface FollowUpsListPage {
  rows: OrderFollowUpWithOrder[];
  nextCursor: string | null;
}

export interface FollowUpsKanbanInitial {
  open: FollowUpsListPage;
  in_progress: FollowUpsListPage;
  resolved: FollowUpsListPage;
  escalated: FollowUpsListPage;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function encodeFollowUpCursor(c: FollowUpsCursor): string {
  return Buffer.from(`${c.updatedAt}|${c.id}`, "utf8").toString("base64url");
}

export function decodeFollowUpCursor(raw: string): FollowUpsCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const idx = decoded.indexOf("|");
    if (idx <= 0) return null;
    const updatedAt = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(updatedAt) || !id) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export async function getFollowUpsPage(
  supabase: SupabaseClient,
  filters: FollowUpsListFilters,
): Promise<FollowUpsListPage> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));

  let query = supabase
    .from("order_follow_ups")
    .select(FOLLOW_UPS_LIST_SELECT)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.agentId) query = query.eq("confirming_agent_id", filters.agentId);
  if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);

  if (filters.cursor) {
    const cur = decodeFollowUpCursor(filters.cursor);
    if (!cur) throw new Error("Invalid cursor");
    query = query.or(
      `updated_at.lt.${cur.updatedAt},and(updated_at.eq.${cur.updatedAt},id.lt.${cur.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as OrderFollowUpWithOrder[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeFollowUpCursor({ updatedAt: last.updated_at, id: last.id })
      : null;

  return { rows: page, nextCursor };
}

/**
 * Prefetch the first page of each Kanban column in parallel.
 * Called from the server component to hydrate `<FollowUpsPageClient />` with
 * zero client-side loading state on first paint.
 */
export async function getFollowUpsKanbanInitial(
  supabase: SupabaseClient,
  filters: Omit<FollowUpsListFilters, "status" | "cursor">,
): Promise<FollowUpsKanbanInitial> {
  const [open, in_progress, resolved, escalated] = await Promise.all(
    FOLLOW_UP_STATUSES.map((status) =>
      getFollowUpsPage(supabase, { ...filters, status }),
    ),
  );

  return { open, in_progress, resolved, escalated };
}
