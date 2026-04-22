import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getLeadsMetrics, type LeadsMetrics } from "@/lib/leads/metrics";

export type CrmMetricsResponse = LeadsMetrics;

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? null
      : actor.market_id ?? null;

  const dateFrom = req.nextUrl.searchParams.get("date_from");
  const dateTo = req.nextUrl.searchParams.get("date_to");

  const supabase = await createClient();
  try {
    const data = await getLeadsMetrics(supabase, {
      marketId: marketId || null,
      dateFrom,
      dateTo,
    });
    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
