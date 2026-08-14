import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { restampMappedProduct } from "@/lib/meta-ads/sync";

/**
 * Campaign → product mapping, declared once by a human.
 *
 * This exists because no order in this system carries ad attribution. All 7,137
 * production orders were checked: zero utm_*, zero fbclid, zero campaign ids, in
 * columns or in `orders.raw_payload`, across both storefront platforms. There is
 * no click-level join to be had, so attribution has to be asserted rather than
 * derived, and the honest ceiling is campaign → product rather than ad → order.
 *
 * Saving a mapping re-stamps that campaign's existing `ad_spend` rows. That is
 * what keeps the retroactive-correction property of a read-time join while
 * still writing `product_id` into the column six other read paths depend on.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canViewFinanceSection(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adAccountId = req.nextUrl.searchParams.get("ad_account_id");
  const adminClient = createAdminClient();

  let query = adminClient
    .from("meta_campaign_mappings")
    .select("id, ad_account_id, external_campaign_id, campaign_name, market_id, product_id, updated_at");

  if (adAccountId) query = query.eq("ad_account_id", adAccountId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { ad_account_id, external_campaign_id, campaign_name, market_id } = body;

  if (!ad_account_id || !external_campaign_id || !market_id) {
    return NextResponse.json(
      { error: "ad_account_id, external_campaign_id and market_id are required" },
      { status: 400 },
    );
  }

  // `product_id` may legitimately be null — that is an explicit decision that
  // this campaign is market-level, which is different from never having been
  // looked at. Both store NULL; the row's existence is what distinguishes them.
  const productId = body.product_id ?? null;

  const adminClient = createAdminClient();

  const { data, error } = await adminClient
    .from("meta_campaign_mappings")
    .upsert(
      {
        ad_account_id,
        external_campaign_id,
        campaign_name: campaign_name ?? null,
        market_id,
        product_id: productId,
        mapped_by: actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ad_account_id,external_campaign_id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Apply the decision backwards over everything already synced, so mapping a
  // campaign corrects its history instead of only affecting future rows.
  const restamped = await restampMappedProduct(adminClient, {
    adAccountId: ad_account_id,
    externalCampaignId: external_campaign_id,
    productId,
  });

  return NextResponse.json({ data, meta: { rows_restamped: restamped } }, { status: 201 });
}
