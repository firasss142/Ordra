import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { recordJournalEvent } from "@/lib/journal/record-event";

/**
 * POST /api/prospects/campaigns/[id]/launch — an API-sent campaign whose
 * template Meta approved. Spawns the prospects (rpc_run_prospect_campaign,
 * exactly as an agent-sent campaign does at creation) then queues one paced
 * send per prospect (whatsapp_enqueue_campaign). 409 until the template is
 * APPROVED: a campaign whose message cannot leave puts nobody in a queue.
 */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await createClient();
  const { data: campaign, error } = await user
    .from("prospect_campaigns")
    .select("id, market_id, name, wa_sender, wa_template_id, wa_launch_status, whatsapp_templates:wa_template_id ( status )")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (actor.role === "market_manager" && campaign.market_id !== actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (campaign.wa_sender !== "api") return NextResponse.json({ error: "not_api_campaign" }, { status: 409 });

  const tpl = campaign.whatsapp_templates as unknown as { status?: string } | { status?: string }[] | null;
  const templateStatus = Array.isArray(tpl) ? tpl[0]?.status : tpl?.status;
  if (!campaign.wa_template_id || templateStatus !== "APPROVED") {
    return NextResponse.json({ error: "template_not_approved", template_status: templateStatus ?? null }, { status: 409 });
  }
  if (campaign.wa_launch_status === "launched") {
    // Idempotent: re-launching only adds prospects that were missing.
  }

  const { data: run, error: runError } = await user.rpc("rpc_run_prospect_campaign", {
    p_campaign_id: params.id,
    p_actor_id: actor.id,
    p_actor_type: actor.role === "super_admin" ? "super_admin" : "manager",
  });
  if (runError) {
    console.error("[campaigns/launch] run failed", runError);
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }

  const admin = createAdminClient({ actorId: actor.id });
  const { data: queued, error: queueError } = await admin.rpc("whatsapp_enqueue_campaign", { p_campaign_id: params.id });
  if (queueError) {
    console.error("[campaigns/launch] enqueue failed", queueError);
    return NextResponse.json({ error: "enqueue_failed", message: queueError.message }, { status: 500 });
  }

  const r = (run ?? {}) as { inserted?: number; skipped?: number };
  const q = (queued ?? {}) as { inserted?: number; queued?: number; skipped_by_reason?: Record<string, number> };

  // Journaux: one line per send, in the launcher's name (service role + actor
  // header). Never fails or holds the launch.
  await recordJournalEvent(admin, {
    action: "whatsapp.campaign_sent",
    entityType: "campaign",
    entityId: params.id,
    entityLabel: (campaign as { name?: string | null }).name ?? null,
    marketId: campaign.market_id,
    context: { recipients: q.queued ?? 0 },
  });
  return NextResponse.json({
    id: params.id,
    inserted: r.inserted ?? 0,
    skipped: r.skipped ?? 0,
    queued: q.queued ?? 0,
    skipped_by_reason: q.skipped_by_reason ?? {},
  });
}

export const POST = withRouteErrors("/api/prospects/campaigns/[id]/launch", "POST", handlePOST);
