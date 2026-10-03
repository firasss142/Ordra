import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveMarketForRead } from "@/lib/whatsapp/authz";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * The template registry for one market — what the Modèles page lists and
 * what the agent composer filters (APPROVED + language + catalogue set).
 *
 * Read through the admin client after an explicit market resolution rather
 * than through RLS, so the answer is the same for every role that may look
 * and the market can never be widened by a query parameter.
 */

export const dynamic = "force-dynamic";

const TEMPLATE_COLUMNS =
  "id, market_id, meta_template_id, name, language, category, status, rejected_reason, components, body_text, header_format, footer_text, variables, event_key, catalogue_key, source, campaign_id, synced_at, created_at, updated_at";

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const access = resolveMarketForRead(actorResult.actor, new URL(req.url).searchParams.get("market_id"));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("market_id", access.marketId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  const rows = (data ?? []) as { campaign_id: string | null }[];

  // « Campagne · Sérum · clients 60–120 j » reads better than Meta's
  // generated name. One extra query for the few campaign templates, scoped to
  // the same market so a stray id can never surface another market's name.
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await admin
      .from("prospect_campaigns")
      .select("id, name")
      .eq("market_id", access.marketId)
      .in("id", campaignIds);
    for (const c of (camps ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
  }

  return NextResponse.json({ data: rows.map((r) => ({ ...r, campaign_name: r.campaign_id ? (names.get(r.campaign_id) ?? null) : null })) });
}

export const GET = withRouteErrors("/api/whatsapp/templates", "GET", handleGET);
