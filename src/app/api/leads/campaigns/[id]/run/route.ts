import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const CAMPAIGNS_TABLE = "prospect_campaigns";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from(CAMPAIGNS_TABLE)
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (
    actor.role === "market_manager" &&
    (campaign as { market_id: string }).market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorType = actor.role === "super_admin" ? "super_admin" : "manager";

  const { data, error } = await supabase.rpc("rpc_run_prospect_campaign", {
    p_campaign_id: id,
    p_actor_id: actor.id,
    p_actor_type: actorType,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
