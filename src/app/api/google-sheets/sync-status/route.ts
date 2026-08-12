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

  /**
   * A cursor position is not a health check.
   *
   * This endpoint used to return `last_row` and nothing else, so a sync that
   * had been dying every fifteen minutes for four days looked identical to one
   * that was idle because no new orders had come in — the number just sat
   * still. The last run and the rows it could not import are what actually
   * answer "is the import working".
   */
  const [syncState, sources, runsRes, failuresRes] = await Promise.all([
    getSyncState(adminClient, marketId),
    getSheetsSources(adminClient, marketId),
    adminClient
      .from("sheet_sync_runs")
      .select(
        "id, storefront_id, trigger, status, started_at, finished_at, rows_fetched, rows_imported, rows_duplicate, rows_errored, has_more, error",
      )
      .eq("market_id", marketId)
      .order("started_at", { ascending: false })
      .limit(50),
    adminClient
      .from("sheet_sync_failed_rows")
      .select("id, storefront_id, row_index, message, raw_row, created_at")
      .eq("market_id", marketId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  type Run = {
    storefront_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    [k: string]: unknown;
  };
  const runs = (runsRes.data ?? []) as Run[];
  const failures = failuresRes.data ?? [];

  const perSource = sources.map((s) => {
    const mine = runs.filter((r) => r.storefront_id === s.storefront_id);
    return {
      storefront_id: s.storefront_id,
      platform: s.platform,
      is_active: s.is_active,
      last_row: syncState[s.storefront_id]?.last_row ?? 0,
      // Newest first from the query. `last_run` may still be in flight;
      // `last_success` is the one that says orders are arriving.
      last_run: mine[0] ?? null,
      last_success:
        mine.find((r) => r.status === "succeeded" || r.status === "partial") ?? null,
      open_failures: failures.filter(
        (f) => (f as { storefront_id: string }).storefront_id === s.storefront_id,
      ).length,
    };
  });

  return NextResponse.json({
    sources: perSource,
    configs_count: sources.length,
    failures,
  });
}
