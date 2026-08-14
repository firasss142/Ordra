import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { getStockPosition } from "@/lib/inventory/stock-position";
import {
  DEMAND_WINDOW_OPTIONS,
  DEFAULT_DEMAND_WINDOW,
  type DemandWindowDays,
} from "@/lib/inventory/stock-position-types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const windowParam = req.nextUrl.searchParams.get("window");
  let windowDays: DemandWindowDays = DEFAULT_DEMAND_WINDOW;
  if (windowParam !== null) {
    const parsed = Number(windowParam);
    // A window the UI cannot produce is rejected rather than coerced. Silently
    // falling back is how a page ends up showing a period it did not label.
    if (!DEMAND_WINDOW_OPTIONS.includes(parsed as DemandWindowDays)) {
      return NextResponse.json({ error: "Invalid window" }, { status: 400 });
    }
    windowDays = parsed as DemandWindowDays;
  }

  try {
    const position = await getStockPosition({
      windowDays,
      marketId: req.nextUrl.searchParams.get("market_id") || null,
      role: actor.role,
      actorMarketId: actor.market_id ?? null,
    });

    return NextResponse.json(
      { data: position },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
