import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/lib/orders/list-filters";
import { resolveProductDisplayName, unwrapEmbed } from "@/lib/orders/display-name";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";
import { enrichRowsWithDuplicates } from "@/lib/duplicate-orders/detect";

export const dynamic = "force-dynamic";

const LIST_SELECT =
  "id, external_id, external_platform, market_id, customer_name, customer_phone, customer_phone_2, " +
  "customer_address, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, attempts_count, " +
  "carrier_barcode_deleted_at, carrier_barcode_deleted_carrier_code, " +
  "created_at, updated_at, " +
  "product:products(image_url, name)";

export async function GET(req: NextRequest) {
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
  let query = supabase
    .from("orders")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(q.limit + 1); // peek one extra to know if there's a next page

  if (marketId) query = query.eq("market_id", marketId);
  // "Afficher supprimées" toggle: when on, show ONLY soft-deleted orders;
  // when off (default), hide deleted orders entirely.
  if (q.include_deleted) query = query.eq("status", "deleted");
  else query = query.neq("status", "deleted");

  // ---- Preset filters ----
  switch (q.preset) {
    case "unassigned":
      query = query.eq("status", "pending").is("assigned_to", null);
      break;
    case "callbacks":
      query = query
        .eq("status", "callback_scheduled")
        .lte("callback_scheduled_at", new Date().toISOString());
      break;
    case "today": {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      query = query.gte("created_at", start.toISOString());
      break;
    }
    case "in_delivery":
      query = query.in("status", [
        "uploaded",
        "dispatched",
        "deposit",
        "in_transit",
        "to_be_returned",
      ]);
      break;
    case "all":
    default:
      break;
  }

  // ---- Status multi-select ----
  if (q.status) {
    const statuses = q.status.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) query = query.eq("status", statuses[0]);
    else if (statuses.length > 1) query = query.in("status", statuses);
  }

  // ---- Agent filter ----
  if (q.agent_id === "unassigned") query = query.is("assigned_to", null);
  else if (q.agent_id) query = query.eq("assigned_to", q.agent_id);

  // ---- Search (customer name, phone, external id) ----
  if (q.q && q.q.trim().length > 0) {
    const needle = q.q.trim().replace(/[%,]/g, "");
    if (needle) {
      query = query.or(
        `customer_name.ilike.%${needle}%,customer_phone.ilike.%${needle}%,external_id.ilike.%${needle}%,product_name.ilike.%${needle}%`,
      );
    }
  }

  // ---- Advanced filters ----
  if (q.product_id) query = query.eq("product_id", q.product_id);
  if (q.city) query = query.ilike("customer_city", `%${q.city}%`);
  if (q.date_from) query = query.gte("created_at", q.date_from);
  if (q.date_to) {
    // inclusive end-of-day
    query = query.lte("created_at", `${q.date_to}T23:59:59.999Z`);
  }
  if (q.total_min != null) query = query.gte("total_price", q.total_min);
  if (q.total_max != null) query = query.lte("total_price", q.total_max);
  if (q.rejection_reason) query = query.eq("rejection_reason", q.rejection_reason);
  if (q.carrier_id) query = query.eq("carrier_id", q.carrier_id);

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

  const { data, error } = await query;
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
    },
    {
      // Tiny edge cache to absorb double-fires during filter changes
      headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
    },
  );
}
