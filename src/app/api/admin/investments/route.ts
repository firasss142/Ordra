import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments, canViewInvestorAdmin } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** All capital positions, including house capital (investor_id IS NULL). */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewInvestorAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("investment_positions")
    .select(
      "id, investor_id, product_id, market_id, amount, effective_from, effective_to, status, note, created_at, products(name), investors(legal_name)"
    )
    .order("effective_from", { ascending: false });

  // A market_manager sees only their own market.
  if (actor.role === "market_manager") {
    query = query.eq("market_id", actor.market_id ?? "");
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/admin/investments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * Create a capital position.
 *
 * `investor_id: null` records HOUSE capital, which is what keeps the pro-rata
 * denominator honest — without it every investor's share would be computed
 * against investor capital alone and be overstated.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageInvestments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const investorId = body.investor_id === null ? null : String(body.investor_id ?? "");
  const productId = String(body.product_id ?? "");
  const amount = Number(body.amount);
  const effectiveFrom = String(body.effective_from ?? "");
  const effectiveTo = body.effective_to ? String(body.effective_to) : null;

  if (!productId) {
    return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!ISO_DATE.test(effectiveFrom)) {
    return NextResponse.json({ error: "effective_from must be YYYY-MM-DD" }, { status: 400 });
  }
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) {
    return NextResponse.json({ error: "effective_to must be YYYY-MM-DD" }, { status: 400 });
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    return NextResponse.json({ error: "effective_to precedes effective_from" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The position's market must follow the product, not the request body.
  const { data: product } = await admin
    .from("products")
    .select("id, market_id")
    .eq("id", productId)
    .single();

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (investorId) {
    const { data: investor } = await admin
      .from("investors")
      .select("id")
      .eq("id", investorId)
      .single();
    if (!investor) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 });
    }

    // An investor is market-scoped; funding another market's product would
    // mix currencies with no FX model behind it.
    const { data: investorUser } = await admin
      .from("users")
      .select("market_id")
      .eq("id", investorId)
      .single();

    if (investorUser && investorUser.market_id !== product.market_id) {
      return NextResponse.json(
        { error: "Investor and product belong to different markets" },
        { status: 422 }
      );
    }
  }

  const { data, error } = await admin
    .from("investment_positions")
    .insert({
      investor_id: investorId || null,
      product_id: productId,
      market_id: product.market_id,
      amount,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      status: "active",
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      created_by: actor.id,
    })
    .select("id, investor_id, product_id, amount, effective_from, effective_to, status")
    .single();

  if (error) {
    console.error("[POST /api/admin/investments]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
