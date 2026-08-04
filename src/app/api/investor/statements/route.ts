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
    const r = row as Record<string, unknown>;
    const rel = r.products as { name: string } | { name: string }[] | undefined;
    const product = Array.isArray(rel) ? rel[0] : rel;

    // Strip cost_inputs to a whitelist.
    //
    // The full blob carries market_wide_ad_spend (the WHOLE market's ad budget,
    // across every product — business data an investor has no claim to) and
    // capital_basis.total (house capital plus every other investor's capital).
    // Combined with investor_capital on the same row, that is enough to derive
    // the cap table. The UI never rendered any of it.
    const ci = (r.cost_inputs ?? {}) as Record<string, unknown>;
    const safeCostInputs = {
      allocated_ad_spend: ci.allocated_ad_spend ?? 0,
      gross_share_before_loss: ci.gross_share_before_loss ?? 0,
      carried_loss_before: ci.carried_loss_before ?? 0,
      carried_loss_after: ci.carried_loss_after ?? 0,
      reserve_pct: ci.reserve_pct ?? 0,
      reserve_release_after: ci.reserve_release_after ?? null,
    };

    return {
      ...r,
      // total_capital is the denominator behind share_pct. share_pct alone
      // justifies the split without disclosing anyone else's position size.
      total_capital: undefined,
      products: undefined,
      product_name: product?.name ?? "—",
      cost_inputs: safeCostInputs,
    };
  });

  return NextResponse.json({ data: rows });
}
