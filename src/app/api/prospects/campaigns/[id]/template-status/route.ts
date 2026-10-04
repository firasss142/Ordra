import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { syncTemplatesFromMeta } from "@/lib/whatsapp/templates";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/prospects/campaigns/[id]/template-status — « Vérifier le statut »:
 * the fallback when the approval webhook did not arrive. Syncs the market's
 * templates from Meta, then flips the campaign the way the webhook would.
 */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const user = await createClient();
  const { data: campaign } = await user.from("prospect_campaigns").select("id, market_id, wa_template_id, wa_launch_status").eq("id", params.id).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (actor.role === "market_manager" && campaign.market_id !== actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!campaign.wa_template_id) return NextResponse.json({ error: "no_template" }, { status: 409 });

  const admin = createAdminClient({ actorId: actor.id });
  const cfg = await loadConfigForMarket(admin, campaign.market_id as string);
  if (!cfg || cfg.status !== "active" || cfg.decryptFailed) return NextResponse.json({ error: "config_inactive" }, { status: 409 });

  try {
    await syncTemplatesFromMeta(admin, cfg, createWhatsAppClient(cfg));
  } catch (err) {
    return NextResponse.json({ error: "graph_failed", message: err instanceof Error ? err.message : "Meta injoignable" }, { status: 502 });
  }
  const { data: tpl } = await admin.from("whatsapp_templates").select("status, rejected_reason, name").eq("id", campaign.wa_template_id as string).maybeSingle();
  const status = (tpl as { status?: string } | null)?.status ?? "UNKNOWN";
  let launch = campaign.wa_launch_status as string;
  if (launch === "pending_template" && (status === "APPROVED" || status === "REJECTED")) {
    launch = status === "APPROVED" ? "ready" : "rejected";
    await admin.from("prospect_campaigns").update({ wa_launch_status: launch }).eq("id", params.id);
  }
  return NextResponse.json({ id: params.id, template_status: status, template_name: (tpl as { name?: string } | null)?.name ?? null, rejected_reason: (tpl as { rejected_reason?: string | null } | null)?.rejected_reason ?? null, wa_launch_status: launch });
}

export const POST = withRouteErrors("/api/prospects/campaigns/[id]/template-status", "POST", handlePOST);
