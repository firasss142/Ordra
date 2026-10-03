import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
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
    { data: summary },
    {
      headers: {
        "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
      },
    },
  );
}

export const GET = withRouteErrors("/api/warehouse/summary", "GET", handleGET);
