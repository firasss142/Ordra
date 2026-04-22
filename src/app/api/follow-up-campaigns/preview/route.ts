import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { buildCampaignPreview } from "@/lib/orders/filter";
import type { CampaignFilterJson } from "@/types/follow-up";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const filterJson = (body.filter_json ?? {}) as CampaignFilterJson;
  const marketId =
    role === "super_admin"
      ? (body.market_id as string | undefined) ?? actor.market_id
      : actor.market_id;

  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  try {
    const result = await buildCampaignPreview(supabase, marketId, filterJson);
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[POST /api/follow-up-campaigns/preview]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
