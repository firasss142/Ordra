// GET /api/products/overview?market_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The /products list (Produits v6): every live product of the market with what
// the orders it RECEIVED in the period became, followed to today, and their
// money on the owner's rules (plans/products-redesign-v6.md §3–§4).
//
// One RPC (get_product_cohort) for the facts; the buckets and the money are
// computed here, server-side, by lib/products/overview.ts. The whole catalogue
// comes back — a market holds a few dozen products — so the page filters,
// searches and sorts without another round trip and every count it shows is
// counted over the same rows it draws.

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
  buildProductsOverview,
  leadDaysOf,
  normalizeCohortPayload,
  toCatalogueProduct,
} from "@/lib/products/overview";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewProductProfitability(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // super_admin names the market; a manager is pinned to their own whatever
  // they send. The RPC enforces the same rule a second time in SQL.
  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  const tz = marketTimezone(marketId);
  const period = resolvePeriod(
    req.nextUrl.searchParams.get("from"),
    req.nextUrl.searchParams.get("to"),
    tz,
  );

  const supabase = await createClient();
  const [marketRes, leadRaw, catalogueRes, cohortRes] = await Promise.all([
    supabase.from("markets").select("currency").eq("id", marketId).maybeSingle(),
    getMarketSetting(
      supabase as unknown as Parameters<typeof getMarketSetting>[0],
      marketId,
      "supplier_lead_time_days",
      String(DEFAULT_SUPPLIER_LEAD_TIME_DAYS),
    ),
    supabase
      .from("products")
      .select(CATALOGUE_COLUMNS)
      .eq("market_id", marketId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    supabase.rpc("get_product_cohort", {
      p_market_id: marketId,
      p_from: period.from,
      p_to: period.to,
      p_tz: tz,
      p_product_id: null,
    }),
  ]);

  if (catalogueRes.error || cohortRes.error) {
    console.error("[api/products/overview] read failed", catalogueRes.error ?? cohortRes.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const currency = (marketRes.data as { currency?: string } | null)?.currency ?? "TND";
  const cohort = { ...normalizeCohortPayload(cohortRes.data), from: period.from, to: period.to, tz };
  const catalogue = ((catalogueRes.data ?? []) as Record<string, unknown>[]).map(toCatalogueProduct);

  const body = buildProductsOverview({
    catalogue,
    cohort,
    leadDays: leadDaysOf(leadRaw),
    currency,
    now: new Date(),
  });

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
  });
}

export const GET = withRouteErrors("/api/products/overview", "GET", handleGET);
