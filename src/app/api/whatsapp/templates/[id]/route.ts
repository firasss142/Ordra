import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { catalogueEntry } from "@/lib/whatsapp/catalogue";
import { placeholderCount } from "@/lib/whatsapp/templates";
import { isLifecycleEventKey, type TemplateVariable } from "@/lib/whatsapp/types";
import { resolveMarketForManage } from "@/lib/whatsapp/authz";

/**
 * One registry row: map or unmap its lifecycle event (manager), or delete it
 * at Meta and here (super_admin).
 *
 * A mapping moves: setting `shipped` on a template takes it off whichever
 * template held `shipped` for that language, so the manager never meets the
 * partial unique index as an error. The variables must cover what the event
 * renders, or the drain would send "—" for the tracking number.
 */

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  market_id: string;
  name: string;
  language: string;
  status: string;
  event_key: string | null;
  variables: string[] | null;
  body_text: string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  // Which template a lifecycle event sends decides what customers receive
  // automatically — a super_admin decision, like Paramètres › WhatsApp. Modèles
  // is read-only for a market manager (prototypes/whatsapp-manager-v1.html).
  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_templates")
    .select("id, market_id, name, language, status, event_key, variables, body_text")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as Row;

  const access = resolveMarketForManage(actor, row.market_id);
  if (!access.ok || access.marketId !== row.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { event_key?: unknown };
  if (!("event_key" in body)) return NextResponse.json({ error: "event_key is required (or null)" }, { status: 400 });
  const eventKey = body.event_key;
  const now = new Date().toISOString();

  if (eventKey === null) {
    const { error: e } = await admin.from("whatsapp_templates").update({ event_key: null, updated_at: now }).eq("id", row.id);
    if (e) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    return NextResponse.json({ data: { id: row.id, event_key: null } });
  }

  if (!isLifecycleEventKey(eventKey)) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  if (row.language !== "ar" && row.language !== "fr") {
    return NextResponse.json({ error: "invalid_language", message: "Seuls les modèles ar / fr peuvent servir un événement." }, { status: 400 });
  }
  const variables = (row.variables ?? []) as TemplateVariable[];
  const needed = placeholderCount(row.body_text ?? "");
  if (needed > variables.length) {
    return NextResponse.json(
      { error: "variables_unknown", message: "Les variables de ce modèle ne sont pas connues d'Ordra — il ne peut pas être rempli automatiquement." },
      { status: 400 },
    );
  }
  const required = catalogueEntry(eventKey)?.variables ?? [];
  const missing = required.filter((v) => !variables.includes(v));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "variables_mismatch", message: `Il manque ${missing.join(", ")} à ce modèle pour l'événement « ${eventKey} ».`, missing },
      { status: 400 },
    );
  }

  // Move the mapping: only one template per (market, event, language).
  const { error: clearError } = await admin
    .from("whatsapp_templates")
    .update({ event_key: null, updated_at: now })
    .eq("market_id", row.market_id)
    .eq("language", row.language)
    .eq("event_key", eventKey)
    .neq("id", row.id);
  if (clearError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const { error: setError } = await admin.from("whatsapp_templates").update({ event_key: eventKey, updated_at: now }).eq("id", row.id);
  if (setError) {
    if ((setError as { code?: string }).code === "23505") return NextResponse.json({ error: "event_taken" }, { status: 409 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: { id: row.id, event_key: eventKey } });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("whatsapp_templates").select("id, market_id, name, language").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as Row;

  // Meta deletes by NAME, every language at once; the registry follows suit
  // for the same name in this market.
  const cfg = await loadConfigForMarket(admin, row.market_id);
  if (cfg && cfg.status === "active" && !cfg.decryptFailed) {
    try {
      await createWhatsAppClient(cfg).deleteTemplate(row.name);
    } catch (err) {
      return NextResponse.json({ error: "graph_failed", message: err instanceof Error ? err.message : "Meta injoignable" }, { status: 502 });
    }
  }
  const { error: delError } = await admin.from("whatsapp_templates").delete().eq("market_id", row.market_id).eq("name", row.name);
  if (delError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  return NextResponse.json({ data: { deleted: true } });
}
