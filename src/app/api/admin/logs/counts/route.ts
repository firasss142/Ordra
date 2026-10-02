import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { carrierCodesOfMarket, storefrontIdsOfMarket } from "@/lib/logs/market-scope";

export const dynamic = "force-dynamic";

const SYNC_TABLES = ["sheet_sync_runs", "ad_sync_runs", "darb_sync_runs", "darb_rate_harvest_runs"];

/**
 * GET /api/admin/logs/counts?market_id= — the Journaux tab badges: orders
 * received, carrier events (total and failed) and failed synchronisations over
 * the last 24 hours. Counted with HEAD requests, never loaded: carrier events
 * run to ~20 000 a day. super_admin only.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const marketId = req.nextUrl.searchParams.get("market_id");
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [shopIds, carrierCodes] = marketId
    ? await Promise.all([storefrontIdsOfMarket(supabase, marketId), carrierCodesOfMarket(supabase, marketId)])
    : [null, null];

  const count = async (table: string, column: "status" | "outcome", failedOnly: boolean, scope: { col: string; values: string[] | null }) => {
    if (scope.values && scope.values.length === 0) return 0;
    let q = supabase.from(table).select("id", { count: "exact", head: true }).gte("created_at", since);
    if (scope.values) q = q.in(scope.col, scope.values);
    if (failedOnly) q = q.eq(column, "error");
    const { count: n } = await q;
    return n ?? 0;
  };

  const [rTotal, rFailed, cTotal, cFailed, ...syncFailed] = await Promise.all([
    count("webhook_delivery_log", "status", false, { col: "storefront_id", values: shopIds }),
    count("webhook_delivery_log", "status", true, { col: "storefront_id", values: shopIds }),
    count("carrier_event_log", "outcome", false, { col: "carrier_code", values: carrierCodes }),
    count("carrier_event_log", "outcome", true, { col: "carrier_code", values: carrierCodes }),
    ...SYNC_TABLES.map(async (table) => {
      const { count: n, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .gte("started_at", since)
        .eq("status", "failed");
      return error ? 0 : n ?? 0;
    }),
  ]);

  return NextResponse.json({
    received: { total: rTotal, failed: rFailed },
    carrier: { total: cTotal, failed: cFailed },
    sync: { failed: syncFailed.reduce((a, b) => a + b, 0) },
  });
}
