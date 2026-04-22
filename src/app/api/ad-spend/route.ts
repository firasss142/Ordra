import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewProfitability } from "@/lib/profitability-permissions";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  if (!canViewProfitability(role)) {
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

  let query = supabase
    .from("ad_spend")
    .select("id, market_id, product_id, amount, period_start, period_end, note, created_by, created_at, is_active")
    .eq("market_id", marketId)
    .eq("is_active", true)
    .order("period_start", { ascending: false });

  if (fromDate && toDate) {
    query = query.lte("period_start", toDate).gte("period_end", fromDate);
  }

  const productId = req.nextUrl.searchParams.get("product_id");
  if (productId) {
    query = query.eq("product_id", productId);
  } else {
    query = query.is("product_id", null);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canViewProfitability(role)) {
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
