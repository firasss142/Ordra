import { marketDayBounds } from "@/lib/dates/market-day";
import { resolveArchiveStatuses } from "@/lib/orders/archive-scope";
import { applySearch } from "@/lib/orders/search-query";
import { NONE, RECALL_STATUSES, UNASSIGNED, csvList, type ListQuery } from "@/lib/orders/list-filters";

/**
 * Every filter of the Commandes list and of Archivées, in one place.
 *
 * /api/orders/list and /api/orders/export both call this, so the CSV is the
 * rows the operator saw; get_order_facet_counts_v2 restates the same predicates
 * in SQL (the migration says so next to each one).
 */

/** The subset of the PostgREST builder this needs; each call hands the builder back. */
export interface FilterBuilder {
  eq(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  in(column: string, values: readonly unknown[]): this;
  is(column: string, value: null): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string): this;
  gte(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
}

export interface ListQueryContext {
  marketId: string | null;
  now: Date;
  /** The market's midnight today, as a UTC instant (lib/dates/market-day). */
  todayStartIso: string | null;
  /** Orders with an `uploaded` transition since midnight — read only for the uploaded_today preset. */
  uploadedTodayIds: string[];
  /** The market's auto_archive_after_days; splits « Prêtes à ranger » from « Encore récentes ». */
  archiveAfterDays: number;
}

/** A PostgREST `in.(…)` list with every value double-quoted, so commas and parentheses in a city name survive. */
export function inList(values: string[]): string {
  return `(${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
}

/**
 * A facet that can also pick "nothing set" (no agent, no city, not sent yet):
 * the values become IN, the « none » pick becomes IS NULL, both together an OR.
 */
function withNone<T extends FilterBuilder>(
  query: T,
  column: string,
  picked: string[],
  noneToken: string,
  emptyStringIsNone = false,
): T {
  const values = picked.filter((v) => v !== noneToken);
  const none = picked.includes(noneToken);
  if (!none) return values.length ? query.in(column, values) : query;
  const nullLegs = emptyStringIsNone ? `${column}.is.null,${column}.eq.""` : `${column}.is.null`;
  if (!values.length) return emptyStringIsNone ? query.or(nullLegs) : query.is(column, null);
  return query.or(`${nullLegs},${column}.in.${inList(values)}`);
}

export function applyOrderListFilters<T extends FilterBuilder>(query: T, q: ListQuery, ctx: ListQueryContext): T {
  let out = query;
  if (ctx.marketId) out = out.eq("market_id", ctx.marketId);

  if (q.scope === "archive") {
    if (q.state === "deleted") {
      // Supprimées: every soft-deleted order, wherever it sat.
      out = out.eq("status", "deleted");
    } else {
      // Finished orders; `deleted` has its own tab.
      out = out
        .not("terminal_at", "is", null)
        .neq("status", "deleted")
        .in("status", resolveArchiveStatuses(q.status).filter((s) => s !== "deleted"));
      const cutoff = new Date(ctx.now.getTime() - ctx.archiveAfterDays * 86_400_000).toISOString();
      if (q.state === "archived") out = out.not("archived_at", "is", null);
      else if (q.state === "eligible") out = out.is("archived_at", null).lt("terminal_at", cutoff);
      else out = out.is("archived_at", null).gte("terminal_at", cutoff);
    }
  } else {
    // Put away orders leave the working list — that is all archiving does.
    out = out.is("archived_at", null).neq("status", "deleted");

    switch (q.preset) {
      case "today":
        if (ctx.todayStartIso) out = out.gte("created_at", ctx.todayStartIso);
        break;
      case "unassigned":
        out = out.eq("status", "pending").is("assigned_to", null);
        break;
      case "recall":
        out = out.in("status", [...RECALL_STATUSES]);
        break;
      case "uploaded_today":
        out = out.in("id", ctx.uploadedTodayIds);
        break;
      default:
        break;
    }

    const statuses = csvList(q.status);
    if (statuses.length) out = out.in("status", statuses);
  }

  out = withNone(out, "assigned_to", csvList(q.agent_id), UNASSIGNED);
  const stores = csvList(q.storefront_id);
  if (stores.length) out = out.in("storefront_id", stores);
  out = withNone(out, "customer_city", csvList(q.city), NONE, true);
  const products = csvList(q.product_id);
  if (products.length) out = out.in("product_id", products);
  out = withNone(out, "carrier_id", csvList(q.carrier_id), NONE);

  // Terms AND, each term ORs across every column a dispatcher can see.
  out = applySearch(out, q.q);

  // Calendar dates name the market's local day; created_at is UTC.
  const window = marketDayBounds(q.date_from ?? null, q.date_to ?? null, ctx.marketId);
  if (window.fromIso) out = out.gte("created_at", window.fromIso);
  if (window.toIso) out = out.lte("created_at", window.toIso);

  return out;
}
