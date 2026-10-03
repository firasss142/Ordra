import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { buildCampaignTemplate, campaignTemplateName, parseSendWindow, validateCampaignBody } from "@/lib/whatsapp/campaign-template";
import { submitCampaignTemplate } from "@/lib/whatsapp/templates";
import { uploadHeaderImage } from "@/lib/whatsapp/campaign-submit";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/prospects/campaigns/[id]/resubmit
 *   { wa_message, wa_language?, wa_image_url?, wa_window?, wa_rate? }
 * — « Modifier et resoumettre » after a rejection. Meta never edits an
 * approved or rejected template in place, so this is a NEW template named
 * `_v2`, `_v3`…; the campaign points at the new one and goes back to
 * pending_template. The pacing (window, rate) may be corrected in the same
 * gesture: nothing is queued before launch, so it is still only a setting.
 */

/** Same bounds as the sheet's number input; the drain's pacing needs ≥ 1. */
const RATE_MAX = 1000;

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    wa_message?: string; wa_language?: "ar" | "fr"; wa_image_url?: string | null; wa_window?: string | null; wa_rate?: number | null;
  };
  const user = await createClient();
  const { data: campaign } = await user
    .from("prospect_campaigns")
    .select("id, market_id, name, wa_sender, wa_language, wa_image_url, wa_launch_status, wa_template_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (actor.role === "market_manager" && campaign.market_id !== actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (campaign.wa_sender !== "api") return NextResponse.json({ error: "not_api_campaign" }, { status: 409 });
  if (campaign.wa_launch_status === "launched") return NextResponse.json({ error: "already_launched" }, { status: 409 });

  const message = (body.wa_message ?? "").trim();
  const errors = validateCampaignBody(message);
  if (errors.length > 0) return NextResponse.json({ error: "invalid_body", errors }, { status: 400 });
  const language = body.wa_language === "ar" || body.wa_language === "fr" ? body.wa_language : ((campaign.wa_language as "ar" | "fr" | null) ?? "fr");
  const imageUrl = body.wa_image_url === undefined ? (campaign.wa_image_url as string | null) : body.wa_image_url;
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) return NextResponse.json({ error: "invalid_image_url" }, { status: 400 });
  // Pacing: only what whatsapp_campaign_slot() would honour. Absent = unchanged.
  const pacing: { wa_window?: string; wa_rate?: number } = {};
  if (body.wa_window !== undefined && body.wa_window !== null) {
    if (!parseSendWindow(body.wa_window)) return NextResponse.json({ error: "invalid_window" }, { status: 400 });
    pacing.wa_window = body.wa_window;
  }
  if (body.wa_rate !== undefined && body.wa_rate !== null) {
    const rate = Number(body.wa_rate);
    if (!Number.isInteger(rate) || rate < 1 || rate > RATE_MAX) return NextResponse.json({ error: "invalid_rate" }, { status: 400 });
    pacing.wa_rate = rate;
  }

  const admin = createAdminClient({ actorId: actor.id });
  const cfg = await loadConfigForMarket(admin, campaign.market_id as string);
  if (!cfg || cfg.status !== "active" || cfg.decryptFailed) return NextResponse.json({ error: "config_inactive" }, { status: 409 });

  // Next version number from what the registry already holds for this campaign.
  const { data: previous } = await admin.from("whatsapp_templates").select("name").eq("campaign_id", params.id);
  const version = ((previous ?? []) as { name: string }[]).length + 1;

  try {
    const client = createWhatsAppClient(cfg);
    const handle = imageUrl ? await uploadHeaderImage(client, imageUrl) : null;
    const built = buildCampaignTemplate({ body: message, language, headerHandle: handle });
    const name = campaignTemplateName(campaign.name as string, new Date(), version);
    const submitted = await submitCampaignTemplate(admin, cfg, client, {
      campaignId: params.id,
      name,
      language,
      components: built.components,
      bodyText: built.bodyText,
      variables: built.variables,
      footerText: built.footerText,
      headerFormat: handle ? "IMAGE" : null,
    });
    await admin
      .from("prospect_campaigns")
      .update({ wa_message: message, wa_language: language, wa_image_url: imageUrl, wa_template_id: submitted.templateId, wa_launch_status: "pending_template", ...pacing })
      .eq("id", params.id);
    return NextResponse.json({ id: params.id, template_id: submitted.templateId, template_name: name, template_status: submitted.status, wa_launch_status: "pending_template" });
  } catch (err) {
    return NextResponse.json({ error: "template_submit_failed", message: err instanceof Error ? err.message : "Meta injoignable" }, { status: 502 });
  }
}

export const POST = withRouteErrors("/api/prospects/campaigns/[id]/resubmit", "POST", handlePOST);
