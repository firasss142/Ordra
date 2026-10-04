import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/lib/orders/list-filters";
import { applyOrderListFilters } from "@/lib/orders/list-query";
import { loadListContext } from "@/lib/orders/list-context";
import { resolveProductDisplayName, unwrapEmbed } from "@/lib/orders/display-name";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";
import { enrichRowsWithDuplicates } from "@/lib/duplicate-orders/detect";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const LIST_SELECT =
  "id, external_id, external_platform, market_id, storefront_id, customer_name, customer_phone, customer_phone_2, " +
  "customer_address, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, tracking_number, rejection_reason, rejection_subreason, rejection_note, " +
  "callback_scheduled_at, attempts_count, " +
  "carrier_barcode_deleted_at, carrier_barcode_deleted_carrier_code, " +
  "created_at, updated_at, terminal_at, archived_at, archived_by, " +
  "product:products!orders_product_id_fkey(image_url, name)";

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  // role gating: agents/warehouse use dedicated queue/warehouse routes
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const q = parsed.data;

  // Market scoping: managers are pinned to own market.
  const marketId =
    actor.role === "super_admin" ? q.market_id ?? null : actorMarketId;
  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  /**
   * How many orders the filters match, whole — not how many fit on the page.
   *
   * Asked for on the first page only. The keyset cursor is part of the WHERE
   * clause, so counting again on page 2 would answer "how many are left below
   * this row", which is a different and useless question. Filters changing
   * resets the list to page 1, so the count a client holds is always the count
   * for the filters it is showing.
   *
   * Exact rather than estimated, and taken in the same round trip as the rows:
   * a separate endpoint would have to restate all fifteen filters below and
   * could then disagree with the table it labels.
   */
  const wantTotal = !q.cursor;

  let query = supabase
    .from("orders")
    .select(LIST_SELECT, wantTotal ? { count: "exact" } : undefined)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1); // peek one extra to know if there's a next page

  // Every filter — scope, shortcut, facets, search, dates — in one function
  // shared with /api/orders/export (lib/orders/list-query).
  const ctx = await loadListContext(supabase, q, marketId);
  query = applyOrderListFilters(query, q, ctx);

  // ---- Keyset cursor ----
  if (q.cursor) {
    const cur = decodeCursor(q.cursor);
    if (!cur) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    // (created_at, id) < (cur.createdAt, cur.id) in DESC ordering:
    //   created_at < cur.createdAt
    //   OR (created_at = cur.createdAt AND id < cur.id)
    query = query.or(
      `created_at.lt.${cur.createdAt},and(created_at.eq.${cur.createdAt},id.lt.${cur.id})`,
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Internal server error", detail: error.message },
      { status: 500 },
    );
  }

  type RawRow = Record<string, unknown> & {
    id: string;
    market_id: string;
    created_at: string;
    product?:
      | { image_url: string | null; name?: string | null }
      | { image_url: string | null; name?: string | null }[]
      | null;
  };
  const rows = ((data ?? []) as unknown) as RawRow[];
  const hasMore = rows.length > q.limit;
  const page: Array<Record<string, unknown> & { id: string; market_id: string; created_at: string }> =
    (hasMore ? rows.slice(0, q.limit) : rows).map((r) => {
      const { product, ...rest } = r;
      return {
        ...rest,
        product_image_url: unwrapEmbed(product)?.image_url ?? null,
        product_display_name: resolveProductDisplayName(r),
      };
    });
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  // Enrich with repeat-buyer signals + duplicate-order detection. Group rows by
  // market so the batch RPCs can scope per-market (super_admin lists may span
  // multiple markets). The two signals are distinct: repeat-buyer is the same
  // customer over time; duplicate is the same order placed twice.
  const byMarket = new Map<string, typeof page>();
  for (const row of page) {
    const mid = row.market_id as string;
    if (!byMarket.has(mid)) byMarket.set(mid, []);
    byMarket.get(mid)!.push(row);
  }
  const enrichedById = new Map<string, Record<string, unknown>>();
  await Promise.all(
    Array.from(byMarket.entries()).map(async ([mid, group]) => {
      const rows = group as unknown as Array<{ id: string } & Record<string, unknown>>;
      // Concurrent, not chained. The two enrichments are independent — each
      // builds its RPC payload from original row fields only, and neither reads
      // a field the other produces — so awaiting one before starting the other
      // just doubled the latency on the critical path of every list load.
      // Both enrichers end in `rows.map(...)`, so index alignment is exact.
      const [withHistory, withDuplicates] = await Promise.all([
        enrichRowsWithCustomerHistory(supabase, mid, "order", rows),
        enrichRowsWithDuplicates(supabase, mid, rows),
      ]);
      for (let i = 0; i < rows.length; i++) {
        enrichedById.set(rows[i].id, { ...withHistory[i], ...withDuplicates[i] });
      }
    }),
  );
  const enrichedPage = page.map(
    (r) => enrichedById.get(r.id) ?? r,
  );

  return NextResponse.json(
    {
      rows: enrichedPage,
      nextCursor,
      // null on a cursor page — "not asked", never "zero".
      total: wantTotal ? count ?? 0 : null,
    },
    {
      // Tiny edge cache to absorb double-fires during filter changes
      headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
    },
  );
}

export const GET = withRouteErrors("/api/orders/list", "GET", handleGET);
