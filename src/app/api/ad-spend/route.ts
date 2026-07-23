import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { getActor } from "@/lib/auth/actor";
import { overlayRealizedMetrics } from "@/lib/ad-spend/realized-metrics";
import type { AdSpendEntryLite, RealizedMetric } from "@/lib/ad-spend/realized-metrics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  if (!canViewFinanceSection(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let marketId: string;
  if (role === "super_admin") {
    const paramMarketId = req.nextUrl.searchParams.get("market_id");
    if (!paramMarketId) {
      return NextResponse.json(
        { error: "market_id query parameter required for super_admin" },
        { status: 400 }
      );
    }
    marketId = paramMarketId;
  } else {
    marketId = actor.market_id ?? "";
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  const productIdParam = req.nextUrl.searchParams.get("product_id");
  const scope = req.nextUrl.searchParams.get("scope"); // "market" | "product" | "all"
  const overlay = req.nextUrl.searchParams.get("overlay"); // "metrics" | null
  const includeProducts = req.nextUrl.searchParams.get("include_products") === "true";

  let query = supabase
    .from("ad_spend")
    .select("id, market_id, product_id, amount, period_start, period_end, note, created_by, created_at, is_active")
    .eq("market_id", marketId)
    .eq("is_active", true)
    .order("period_start", { ascending: false });

  if (fromDate && toDate) {
    query = query.lte("period_start", toDate).gte("period_end", fromDate);
  }

  // Backward compatible: if product_id param given, filter exact; else scope controls.
  if (productIdParam) {
    query = query.eq("product_id", productIdParam);
  } else if (scope === "market") {
    query = query.is("product_id", null);
  } else if (scope === "product") {
    query = query.not("product_id", "is", null);
  }
  // scope === "all" or unset: no filter — return both market-wide and product-scoped.

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const entries = (data ?? []) as AdSpendEntryLite[] & Array<{
    id: string;
    market_id: string;
    product_id: string | null;
    amount: number;
    period_start: string;
    period_end: string;
    note: string | null;
  }>;

  let products: { id: string; name: string }[] = [];
  if (includeProducts) {
    const { data: productRows } = await supabase
      .from("products")
      .select("id, name")
      .eq("market_id", marketId)
      .order("name", { ascending: true });
    products = productRows ?? [];
  }

  if (overlay !== "metrics" || entries.length === 0) {
    return NextResponse.json({
      data: entries,
      products: includeProducts ? products : undefined,
    });
  }

  // --- Realized metrics overlay: for each entry, aggregate confirmations/delivered/revenue ---
  const metricsById: Record<string, RealizedMetric> = {};
  for (const e of entries) metricsById[e.id] = { confirmed_count: 0, delivered_count: 0, revenue: 0 };

  // Fetch all relevant order_history rows for the combined envelope period + market.
  const minStart = entries.reduce((min, e) => (e.period_start < min ? e.period_start : min), entries[0].period_start);
  const maxEnd = entries.reduce((max, e) => (e.period_end > max ? e.period_end : max), entries[0].period_end);

  const [{ data: confRows }, { data: delivRows }] = await Promise.all([
    supabase
      .from("order_history")
      .select("created_at, orders!inner(product_id, market_id)")
      .eq("status_to", "confirmed")
      .eq("orders.market_id", marketId)
      .gte("created_at", minStart)
      .lte("created_at", maxEnd + "T23:59:59"),
    supabase
      .from("order_history")
      .select("created_at, orders!inner(product_id, market_id, total_price)")
      .eq("status_to", "delivered")
      .eq("orders.market_id", marketId)
      .gte("created_at", minStart)
      .lte("created_at", maxEnd + "T23:59:59"),
  ]);

  type ConfRow = { created_at: string; orders: { product_id: string | null } };
  type DelivRow = { created_at: string; orders: { product_id: string | null; total_price: number } };

  const confs = ((confRows ?? []) as unknown as ConfRow[]);
  const delivs = ((delivRows ?? []) as unknown as DelivRow[]);

  const inRange = (createdAt: string, start: string, end: string) => {
    const d = createdAt.slice(0, 10);
    return d >= start && d <= end;
  };

  for (const e of entries) {
    for (const c of confs) {
      if (!inRange(c.created_at, e.period_start, e.period_end)) continue;
      if (e.product_id && c.orders.product_id !== e.product_id) continue;
      metricsById[e.id].confirmed_count += 1;
    }
    for (const d of delivs) {
      if (!inRange(d.created_at, e.period_start, e.period_end)) continue;
      if (e.product_id && d.orders.product_id !== e.product_id) continue;
      metricsById[e.id].delivered_count += 1;
      metricsById[e.id].revenue += Number(d.orders.total_price) || 0;
    }
  }

  const withMetrics = overlayRealizedMetrics(entries as AdSpendEntryLite[], metricsById);

  return NextResponse.json({
    data: withMetrics,
    products: includeProducts ? products : undefined,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canViewFinanceSection(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { amount, period_start, period_end, note, product_id } = body;

  if (!amount || !period_start || !period_end) {
    return NextResponse.json(
      { error: "amount, period_start, and period_end are required" },
      { status: 400 }
    );
  }

  if (Number(amount) <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }

  if (period_start > period_end) {
    return NextResponse.json({ error: "period_start must be before period_end" }, { status: 400 });
  }

  const marketId = role === "super_admin" ? (body.market_id ?? actor.market_id ?? "") : (actor.market_id ?? "");

  const { data, error } = await supabase
    .from("ad_spend")
    .insert({
      market_id: marketId,
      product_id: product_id ?? null,
      amount: Number(amount),
      period_start,
      period_end,
      note: note ?? null,
      created_by: actor.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
