// GET /api/products/[id]/overview?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The product sheet (Produits v6): the orders this product received in the
// period followed to today — outcome flow, why they are lost, where 100 د.ل go,
// day by day, agents, stock — and, over the last 30 days, the per-delivery
// averages the edit page's calculator starts from.
//
// Replaces /api/profitability/product/[productId] (event-dated counts, flat
// carrier fee, packaging per confirmation) and /api/products/[id]/agents (agents
// by last confirmer). One RPC; the figures are built server-side.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { marketTimezone } from "@/lib/markets";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { DEFAULT_SUPPLIER_LEAD_TIME_DAYS } from "@/types/settings";
import { resolvePeriod } from "@/lib/products/period";
import {
  CATALOGUE_COLUMNS,
  buildProductSheet,
  leadDaysOf,
  normalizeCohortPayload,
  toCatalogueProduct,
} from "@/lib/products/overview";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewProductProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: row, error: productError } = await supabase
    .from("products")
    .select(`${CATALOGUE_COLUMNS}, market_id`)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (productError) {
    console.error("[api/products/[id]/overview] product read failed", productError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const marketId = String((row as { market_id: string }).market_id);
  if (actor.role !== "super_admin" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tz = marketTimezone(marketId);
  const period = resolvePeriod(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    tz,
  );

  const [marketRes, leadRaw, cohortRes] = await Promise.all([
    supabase.from("markets").select("currency").eq("id", marketId).maybeSingle(),
    getMarketSetting(
      supabase as unknown as Parameters<typeof getMarketSetting>[0],
      marketId,
      "supplier_lead_time_days",
      String(DEFAULT_SUPPLIER_LEAD_TIME_DAYS),
    ),
    supabase.rpc("get_product_cohort", {
      p_market_id: marketId,
      p_from: period.from,
      p_to: period.to,
      p_tz: tz,
      p_product_id: id,
    }),
  ]);

  if (cohortRes.error) {
    console.error("[api/products/[id]/overview] rpc failed", cohortRes.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const body = buildProductSheet({
    product: toCatalogueProduct(row as Record<string, unknown>),
    cohort: { ...normalizeCohortPayload(cohortRes.data), from: period.from, to: period.to, tz },
    leadDays: leadDaysOf(leadRaw),
    currency: (marketRes.data as { currency?: string } | null)?.currency ?? "TND",
    now: new Date(),
  });

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}

export const GET = withRouteErrors("/api/products/[id]/overview", "GET", handleGET);
