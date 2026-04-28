import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCarriers } from "@/lib/settings-permissions";
import { listAdapterDescriptors } from "@/lib/carriers/adapter-registry";
import { getAllActiveMarkets } from "@/lib/markets/list";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageCarriers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "";

  let marketCode: string | undefined;
  if (marketId) {
    const markets = await getAllActiveMarkets();
    marketCode = markets.find((m) => m.id === marketId)?.code;
  }

  return NextResponse.json({ data: listAdapterDescriptors(marketCode) });
}
