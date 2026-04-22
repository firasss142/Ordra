import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { listMarketsFor } from "@/lib/markets/list";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && !actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await listMarketsFor(role, actor.market_id);
  return NextResponse.json({ data });
}
