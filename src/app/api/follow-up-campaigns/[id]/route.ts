import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

async function resolveCampaign(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase
    .from("follow_up_campaigns")
    .select("id, market_id, name")
    .eq("id", id)
    .single();
  return { campaign: data, error };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role === "agent") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { campaign, error: fetchErr } = await resolveCampaign(supabase, params.id);
  if (fetchErr || !campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Market-scoped: manager can only edit their own market's campaigns
  if (actor.role === "market_manager" && campaign.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = (body.name as string | undefined)?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("follow_up_campaigns")
    .update({ name })
    .eq("id", params.id)
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A campaign with this name already exists" }, { status: 409 });
    console.error("[PATCH /api/follow-up-campaigns/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role === "agent") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { campaign, error: fetchErr } = await resolveCampaign(supabase, params.id);
  if (fetchErr || !campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (actor.role === "market_manager" && campaign.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Null-out campaign_id on associated follow-ups before deleting (keep follow-ups, orphan the link)
  await supabase
    .from("order_follow_ups")
    .update({ campaign_id: null })
    .eq("campaign_id", params.id);

  const { error } = await supabase
    .from("follow_up_campaigns")
    .delete()
    .eq("id", params.id);

  if (error) {
    console.error("[DELETE /api/follow-up-campaigns/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
