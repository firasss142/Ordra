// GET /api/products/[id]/agents — the AGENTS section of the product sheet.
//
// Split from /api/profitability/product/[id] rather than bolted onto it: that
// endpoint answers "how did this product do", this one answers "who did it",
// they page over different tables, and the sheet renders them independently
// (the funnel paints while the leaderboard is still aggregating).
//
// Gates copied from /api/products/list, not from /api/products/[id]. This
// payload carries revenue PER AGENT, so it belongs to
// canViewProductProfitability (super_admin | market_manager) — the same reason
// warehouse_agent sees the product sheet but not this section.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import {
  loadProductAgentPerformance,
  type ProductAgentsClient,
} from "@/lib/products/agent-performance";
import type { ProductAgentsResponse } from "@/types/product-agents";

export const dynamic = "force-dynamic";

/** Strict, not indulgent. A malformed date reaching PostgREST is a 500. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Before any read. Answering 404-vs-403 to an unauthorised caller would leak
  // which product ids exist.
  if (!canViewProductProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Required, never defaulted to "today". This section is read as a cumulative
  // leaderboard; silently answering for one day would look like an empty team.
  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  if (!fromDate || !toDate || !ISO_DATE.test(fromDate) || !ISO_DATE.test(toDate)) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const { data: product } = await supabase
    .from("products")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Market isolation is enforced here as well as by RLS: a manager's own
  // market_id comes from the signed actor, never from a query parameter.
  if (actor.role === "market_manager" && product.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // From the DB, never `code === "ly" ? "LYD" : "TND"` — that ternary read a
  // markets list only fetched for super_admin, so a Libyan manager saw TND.
  const { data: market } = await supabase
    .from("markets")
    .select("currency")
    .eq("id", product.market_id)
    .single();
  const currency = (market as { currency?: string } | null)?.currency ?? "TND";

  // One cast, documented in agent-performance.ts: the generated client type
  // infers the embedded `orders` relation as an array where the query reads it
  // as a single record.
  let data;
  try {
    data = await loadProductAgentPerformance({
      supabase: supabase as unknown as ProductAgentsClient,
      productId: id,
      fromDate,
      toDate,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const body: ProductAgentsResponse = {
    data,
    period: { from_date: fromDate, to_date: toDate },
    currency,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}
