import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/lib/orders/list-filters";

const LIST_SELECT =
  "id, external_id, market_id, customer_name, customer_phone, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, " +
  "created_at, updated_at";

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

  // ---- Preset filters ----
  switch (q.preset) {
    case "unassigned":
      query = query.eq("status", "new").is("assigned_to", null);
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
        `customer_name.ilike.%${needle}%,customer_phone.ilike.%${needle}%,external_id.ilike.%${needle}%`,
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

  const rows = ((data ?? []) as unknown) as Array<
    Record<string, unknown> & { id: string; created_at: string }
  >;
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null;

  return NextResponse.json(
    {
      rows: page,
      nextCursor,
    },
    {
      // Tiny edge cache to absorb double-fires during filter changes
      headers: { "Cache-Control": "private, max-age=2" },
    },
  );
}
