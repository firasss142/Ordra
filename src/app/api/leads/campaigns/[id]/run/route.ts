import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { recordJournalEvent } from "@/lib/journal/record-event";

export const dynamic = "force-dynamic";

const CAMPAIGNS_TABLE = "prospect_campaigns";

async function handlePOST(
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
    .select("id, market_id, name")
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

  // Journaux: one line per run, in the runner's name (service role + actor
  // header — journal_record reserves this action to the server). Never fails
  // or holds the run.
  try {
    const c = campaign as { market_id: string; name?: string | null };
    await recordJournalEvent(createAdminClient({ actorId: actor.id }), {
      action: "whatsapp.campaign_sent",
      entityType: "campaign",
      entityId: id,
      entityLabel: c.name ?? null,
      marketId: c.market_id,
      context: { recipients: (data as { inserted?: number } | null)?.inserted ?? 0 },
    });
  } catch {
    // the journal never turns a run into an error
  }
  return NextResponse.json({ data });
}

export const POST = withRouteErrors("/api/leads/campaigns/[id]/run", "POST", handlePOST);
