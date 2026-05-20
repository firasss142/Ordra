import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getSyncState } from "@/lib/google-sheets/sync-state";
import { getSheetsSources } from "@/lib/google-sheets/sources-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response as NextResponse;
  const { actor } = actorResult;

  if (actor.role === "agent" || actor.role === "warehouse_agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  if (actor.role === "market_manager" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const [syncState, sources] = await Promise.all([
    getSyncState(adminClient, marketId),
    getSheetsSources(adminClient, marketId),
  ]);

  const perSource = sources.map((s) => ({
    storefront_id: s.storefront_id,
    platform: s.platform,
    is_active: s.is_active,
    last_row: syncState[s.storefront_id]?.last_row ?? 0,
  }));

  return NextResponse.json({
    sources: perSource,
    configs_count: sources.length,
  });
}
