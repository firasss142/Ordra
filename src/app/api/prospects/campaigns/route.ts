import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import {
  toFilterJson,
  validateConditions,
  type AudiencePreview,
  type Condition,
} from "@/lib/prospects/audience";
import { createAdminClient } from "@/lib/supabase/server";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { buildCampaignTemplate, campaignTemplateName, validateCampaignBody } from "@/lib/whatsapp/campaign-template";
import { submitCampaignTemplate } from "@/lib/whatsapp/templates";
import { uploadHeaderImage } from "@/lib/whatsapp/campaign-submit";

export const dynamic = "force-dynamic";

/**
 * POST /api/prospects/campaigns — size an audience, or create the campaign.
 *
 * `?preview=1` counts without writing. Both paths send the same filter_json to
 * the database, and the count comes from campaign_audience_rows(), the single
 * definition of who is in a campaign — so the number the manager confirms is
 * the batch they get.
 *
 * The preview returns the exclusions by name. On the rebuy template in Libya,
 * 294 customers match and 290 already have an open prospect: a manager who
 * sees "4" must be able to read why, or they will assume the tool is broken.
 *
 *   market_manager → own market; a market_id in the body is ignored
 *   super_admin    → must name the market
 *   agent          → refused
 *
 * Design: prototypes/prospects-manager-v1.html (the campaign builder).
 */

const CHANNELS = ["call", "wa", "wa_call"];
const SENDERS = ["agent", "api"];
const NAME_MAX = 120;

interface Body {
  market_id?: string;
  name?: string;
  offer?: string | null;
  conditions?: Condition[];
  channel?: string;
  wa_message?: string | null;
  wa_image?: boolean;
  wa_sender?: string;
  wa_window?: string | null;
  wa_rate?: number | null;
  wa_follow_up_hours?: number | null;
  script_fr?: string | null;
  script_ar?: string | null;
  /** api sender only: the template's language and its optional header image. */
  wa_language?: "ar" | "fr";
  wa_image_url?: string | null;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketId = actor.role === "super_admin" ? body.market_id : actor.market_id;
  if (!marketId || !UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  if (conditions.length === 0) {
    return NextResponse.json({ error: "conditions_required" }, { status: 400 });
  }

  // What would silently empty the audience is refused here, with the offending
  // condition named, so the composer can point at a field instead of showing
  // a confident zero.
  const errors = validateConditions(conditions);
  if (errors.length > 0) {
    return NextResponse.json({ error: "invalid_conditions", errors }, { status: 400 });
  }

  const filter = toFilterJson(conditions);
  const supabase = await createClient();
  const preview = req.nextUrl.searchParams.get("preview") === "1";

  if (preview) {
    const { data, error } = await supabase.rpc("preview_campaign_audience", {
      p_market_id: marketId,
      p_filter: filter,
    });
    if (error) {
      console.error("[api/prospects/campaigns] preview failed", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json((data ?? {}) as AudiencePreview);
  }

  const name = (body.name ?? "").trim();
  if (!name || name.length > NAME_MAX) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const channel = body.channel ?? "call";
  if (!CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
  }

  const waMessage = (body.wa_message ?? "").trim();
  // The table has a CHECK for this; catching it first gives the composer a
  // field to highlight rather than a constraint violation to translate.
  if (channel !== "call" && waMessage === "") {
    return NextResponse.json({ error: "wa_message_required" }, { status: 400 });
  }

  const sender = body.wa_sender ?? "agent";
  if (!SENDERS.includes(sender)) {
    return NextResponse.json({ error: "invalid_sender" }, { status: 400 });
  }

  // Sent from the business number: the message becomes a Meta MARKETING
  // template. Its rules are checked here, and the market must have a live
  // number, before a row exists.
  const apiSend = channel !== "call" && sender === "api";
  const waLanguage: "ar" | "fr" | null = apiSend ? (body.wa_language === "ar" ? "ar" : "fr") : null;
  const waImageUrl = apiSend && typeof body.wa_image_url === "string" && body.wa_image_url.trim() ? body.wa_image_url.trim() : null;
  let apiCfg: Awaited<ReturnType<typeof loadConfigForMarket>> = null;
  if (apiSend) {
    const bodyErrors = validateCampaignBody(waMessage);
    if (bodyErrors.length > 0) {
      return NextResponse.json({ error: "invalid_wa_message", errors: bodyErrors }, { status: 400 });
    }
    if (waImageUrl && !/^https:\/\//i.test(waImageUrl)) {
      return NextResponse.json({ error: "invalid_image_url" }, { status: 400 });
    }
    apiCfg = await loadConfigForMarket(createAdminClient(), marketId);
    if (!apiCfg || apiCfg.status !== "active" || apiCfg.decryptFailed) {
      return NextResponse.json({ error: "whatsapp_not_connected" }, { status: 409 });
    }
  }

  const { data: created, error: insertError } = await supabase
    .from("prospect_campaigns")
    .insert({
      market_id: marketId,
      name,
      filter_json: filter,
      offer: body.offer?.trim() || null,
      script_fr: body.script_fr?.trim() || null,
      script_ar: body.script_ar?.trim() || null,
      channel,
      wa_message: channel === "call" ? null : waMessage,
      wa_image: Boolean(body.wa_image),
      wa_sender: sender,
      wa_window: body.wa_window ?? null,
      wa_rate: numberOrNull(body.wa_rate),
      wa_follow_up_hours: channel === "wa_call" ? numberOrNull(body.wa_follow_up_hours) : null,
      created_by: actor.id,
      ...(apiSend ? { wa_language: waLanguage, wa_image_url: waImageUrl, wa_launch_status: "pending_template" } : {}),
    })
    .select("id")
    .single();

  if (insertError) {
    // UNIQUE (market_id, name): the manager reused a name, which is a thing to
    // tell them about, not a server fault.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "duplicate_name" }, { status: 409 });
    }
    console.error("[api/prospects/campaigns] insert failed", insertError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const campaignId = (created as { id: string }).id;

  // Business-number campaigns do NOT run yet: the template goes to Meta and
  // the launch route spawns the prospects once it is approved. Putting names
  // in agents' queues for a message that cannot leave is the wrong order.
  if (apiSend && apiCfg) {
    try {
      const admin = createAdminClient();
      const client = createWhatsAppClient(apiCfg);
      const handle = waImageUrl ? await uploadHeaderImage(client, waImageUrl) : null;
      const built = buildCampaignTemplate({ body: waMessage, language: waLanguage!, headerHandle: handle });
      const templateName = campaignTemplateName(name);
      const submitted = await submitCampaignTemplate(admin, apiCfg, client, {
        campaignId,
        name: templateName,
        language: waLanguage!,
        components: built.components,
        bodyText: built.bodyText,
        variables: built.variables,
        footerText: built.footerText,
        headerFormat: handle ? "IMAGE" : null,
      });
      await admin.from("prospect_campaigns").update({ wa_template_id: submitted.templateId }).eq("id", campaignId);
      return NextResponse.json({
        id: campaignId,
        inserted: 0,
        skipped: 0,
        wa_launch_status: "pending_template",
        template_id: submitted.templateId,
        template_name: templateName,
        template_status: submitted.status,
      });
    } catch (err) {
      // The campaign row stays as a draft the manager can resubmit from the list.
      await createAdminClient().from("prospect_campaigns").update({ wa_launch_status: "draft" }).eq("id", campaignId);
      return NextResponse.json(
        { id: campaignId, error: "template_submit_failed", message: err instanceof Error ? err.message : "Meta injoignable" },
        { status: 502 },
      );
    }
  }

  // Creating and running are one act for the manager: a campaign that exists
  // but has produced nobody is not something they asked for.
  const { data: run, error: runError } = await supabase.rpc("rpc_run_prospect_campaign", {
    p_campaign_id: campaignId,
    p_actor_id: actor.id,
    p_actor_type: actor.role === "super_admin" ? "super_admin" : "manager",
  });

  if (runError) {
    console.error("[api/prospects/campaigns] run failed", runError);
    // The campaign is saved; only the run failed. Saying so lets the manager
    // retry from the list instead of creating a duplicate.
    return NextResponse.json({ id: campaignId, error: "run_failed" }, { status: 500 });
  }

  const result = (run ?? {}) as { inserted?: number; skipped?: number };
  return NextResponse.json({
    id: campaignId,
    inserted: result.inserted ?? 0,
    skipped: result.skipped ?? 0,
  });
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}
