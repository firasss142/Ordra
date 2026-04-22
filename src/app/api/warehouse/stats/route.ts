import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";

/**
 * @deprecated Use `/api/warehouse/summary` — returns the full summary payload
 * with KPI deltas, 14-day trend, low-stock list, and recent activity.
 * This endpoint is kept as a thin alias that exposes the legacy 4-count shape
 * for one release window; slated for deletion.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketIdParam = req.nextUrl.searchParams.get("market_id");

  const summary = await getWarehouseSummary({
    role: actor.role,
    actorMarketId: actor.market_id,
    marketId: actor.role === "super_admin" ? marketIdParam ?? "all" : null,
  });

  return NextResponse.json(
    {
      pending_labels: summary.kpis.pendingLabels.current,
      to_scan_out: summary.kpis.toScanOut.current,
      returns_inbox: summary.kpis.returnsInbox.current,
      damaged_this_week: summary.kpis.damagedThisWeek.current,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=2",
      },
    },
  );
}
