import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { momentOf } from "@/lib/feedback/moment";
import { applySearch, parseSearch } from "@/lib/orders/search-query";
import { MARKET_SEARCH_MIN, rankMarketRows } from "@/lib/agent-search/market";
import type { FeedbackLookupCustomer, FeedbackLookupOrder, FeedbackLookupResult } from "@/types/feedback";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const SHOWN = 6;
const FETCH_LIMIT = 50;

interface OrderRow {
  id: string;
  external_id: string | null;
  status: string;
  tracking_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  customer_city: string | null;
  product_id: string | null;
  product_name: string | null;
  created_at: string;
  assigned_to: string | null;
}

/**
 * GET /api/feedback/lookup?q= — « Le client vous rappelle ? » Customers only reach us by
 * calling an agent back, so with no order open the capture window searches by the number on
 * the agent's phone (or a name, or a reference) and lists the caller's orders with the moment
 * each one implies — a delivered order reads « Après livraison » before it is picked.
 *
 * The caller may well have ordered through a colleague, so this reads the whole market with
 * the service-role client, exactly like /api/agent/search: the market comes from the session,
 * never the request (a super_admin's from the scope), and what leaves is a fixed, narrow list
 * — 6 customers, 6 orders. Matching is lib/orders/search-query's, the Orders page's parser.
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canCaptureFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  const market = resolveFeedbackMarket(actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in market) return market.response;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MARKET_SEARCH_MIN || parseSearch(q).length === 0) {
    return NextResponse.json({ error: `Query must be at least ${MARKET_SEARCH_MIN} characters` }, { status: 400, headers: NO_STORE });
  }

  const admin = createAdminClient();
  let query = admin
    .from("orders")
    .select("id, external_id, status, tracking_number, customer_id, customer_name, customer_phone, customer_phone_2, customer_city, product_id, product_name, created_at, assigned_to")
    .eq("market_id", market.marketId)
    .neq("status", "deleted");
  query = applySearch(query, q);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (error) {
    console.error("[api/feedback/lookup]", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500, headers: NO_STORE });
  }

  const ranked = rankMarketRows((data ?? []) as OrderRow[], q, actor.id);
  const shown = ranked.slice(0, SHOWN);

  // Customers in the order their best order ranked; each one's latest order is what picking
  // the customer opens.
  const customerIds: string[] = [];
  const latest = new Map<string, OrderRow>();
  for (const o of ranked) {
    if (!o.customer_id) continue;
    if (!customerIds.includes(o.customer_id)) customerIds.push(o.customer_id);
    const prev = latest.get(o.customer_id);
    if (!prev || o.created_at > prev.created_at) latest.set(o.customer_id, o);
  }
  const topCustomers = customerIds.slice(0, SHOWN);
  const productIds = [...new Set(shown.map((o) => o.product_id).filter((x): x is string => !!x))];
  const closedIds = shown.filter((o) => o.status === "delivered" || o.status === "returned").map((o) => o.id);

  const [custRes, prodRes, histRes] = await Promise.all([
    topCustomers.length
      ? admin.from("customers").select("id, name, phone_normalized, last_city, orders_count").in("id", topCustomers)
      : Promise.resolve({ data: [] }),
    productIds.length ? admin.from("products").select("id, name, image_url").in("id", productIds) : Promise.resolve({ data: [] }),
    closedIds.length
      ? admin
          .from("order_history")
          .select("order_id, status_to, created_at")
          .in("order_id", closedIds)
          .in("status_to", ["delivered", "returned"])
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const customers = new Map(((custRes.data ?? []) as { id: string; name: string | null; last_city: string | null; orders_count: number | null }[]).map((c) => [c.id, c]));
  const products = new Map(((prodRes.data ?? []) as { id: string; name: string; image_url: string | null }[]).map((p) => [p.id, p]));
  const statusAt = new Map<string, string>();
  for (const h of (histRes.data ?? []) as { order_id: string; status_to: string; created_at: string }[]) {
    if (!statusAt.has(h.order_id)) statusAt.set(h.order_id, h.created_at);
  }

  const orders: FeedbackLookupOrder[] = shown.map((o) => {
    const p = o.product_id ? products.get(o.product_id) : undefined;
    return {
      id: o.id,
      ref: o.external_id ?? o.id.slice(0, 8),
      customer_id: o.customer_id,
      customer_name: o.customer_name ?? "",
      customer_phone: o.customer_phone ?? "",
      status: o.status,
      moment: momentOf(o.status, o.tracking_number !== null),
      product: o.product_id ? { id: o.product_id, name: p?.name ?? o.product_name ?? "", image_url: p?.image_url ?? null } : null,
      status_at: statusAt.get(o.id) ?? null,
    };
  });

  const customerRows: FeedbackLookupCustomer[] = topCustomers.map((id) => {
    const c = customers.get(id);
    const last = latest.get(id)!;
    return {
      id,
      name: c?.name?.trim() || last.customer_name || "",
      phone: last.customer_phone ?? "",
      city: c?.last_city ?? last.customer_city ?? null,
      orders: c?.orders_count ?? ranked.filter((o) => o.customer_id === id).length,
      latest_order_id: last.id,
    };
  });

  const body: FeedbackLookupResult = { customers: customerRows, orders };
  return NextResponse.json({ data: body }, { headers: NO_STORE });
}
