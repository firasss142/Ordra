import type { SupabaseClient } from "@supabase/supabase-js";
import type { FollowUpStatus, OrderFollowUpWithOrder } from "@/types/follow-up";
import { FOLLOW_UP_STATUSES } from "@/types/follow-up";
import { decodeKeysetCursor, encodeKeysetCursor } from "@/lib/cursor";

export const FOLLOW_UPS_LIST_SELECT = `
  id, market_id, order_id, status, campaign_id, delivery_man_phone, description,
  confirming_agent_id, resolved_at, due_at, resolution_outcome,
  updated_at, created_at,
  order:orders!inner (
    id, customer_name, customer_phone, customer_city, total_price, status, assigned_to
  ),
  campaign:prospect_campaigns (
    id, name
  )
`;

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
  /**
   * When true, sorts by due_at ASC NULLS LAST (time-first view).
   * When false/omitted, sorts by updated_at DESC (kanban view).
   */
  sortByDue?: boolean;
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

export async function getFollowUpsPage(
  supabase: SupabaseClient,
  filters: FollowUpsListFilters,
): Promise<FollowUpsListPage> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));

  let query = supabase
    .from("order_follow_ups")
    .select(FOLLOW_UPS_LIST_SELECT)
    .limit(limit + 1);

  if (filters.sortByDue) {
    query = query
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
  } else {
    query = query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });
  }

  if (filters.marketId) query = query.eq("market_id", filters.marketId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.agentId) query = query.eq("confirming_agent_id", filters.agentId);
  if (filters.campaignId) query = query.eq("campaign_id", filters.campaignId);

  if (filters.cursor) {
    const cur = decodeKeysetCursor(filters.cursor);
    if (!cur) throw new Error("Invalid cursor");
    if (filters.sortByDue) {
      if (cur.timestamp === "NULL") {
        // All remaining rows also have null due_at — page by id ASC
        query = query.or(`due_at.is.null`).gt("id", cur.id);
      } else {
        // Rows with due_at > cursor, or same due_at with id > cursor, or null (NULLS LAST)
        query = query.or(
          `due_at.gt.${cur.timestamp},and(due_at.eq.${cur.timestamp},id.gt.${cur.id}),due_at.is.null`,
        );
      }
    } else {
      query = query.or(
        `updated_at.lt.${cur.timestamp},and(updated_at.eq.${cur.timestamp},id.lt.${cur.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as OrderFollowUpWithOrder[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  let nextCursor: string | null = null;
  if (hasMore && last) {
    if (filters.sortByDue) {
      nextCursor = encodeKeysetCursor({
        timestamp: last.due_at ?? "NULL",
        id: last.id,
      });
    } else {
      nextCursor = encodeKeysetCursor({ timestamp: last.updated_at, id: last.id });
    }
  }

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
