import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

/**
 * The investor's statement archive.
 *
 * Only settled and paid statements are returned. Drafts are working state for
 * a settlement run that has not been committed, and showing an investor a
 * figure that may still change is exactly how the numbers lose their authority.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewOwnPortfolio(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("investor_statements")
    .select(
      `id, period_start, period_end, revenue, cogs, delivery_cost, return_cost,
       packing_cost, ad_spend_direct, ad_spend_allocated, processing_cost,
       net_profit, delivered_count, returned_count, confirmed_count,
       investor_capital, total_capital, share_pct, investor_share, reserve_held,
       carried_loss_applied, cost_inputs, status, settled_at,
       products(name)`
    )
    .eq("investor_id", actor.id)
    .in("status", ["settled", "paid"])
    .order("period_start", { ascending: false });

  if (error) {
    console.error("[GET /api/investor/statements]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []).map((row) => {
    const rel = (row as { products?: { name: string } | { name: string }[] }).products;
    const product = Array.isArray(rel) ? rel[0] : rel;
    return { ...row, product_name: product?.name ?? "—", products: undefined };
  });

  return NextResponse.json({ data: rows });
}
