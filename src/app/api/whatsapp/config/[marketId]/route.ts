import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { encrypt, decrypt } from "@/lib/crypto";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { classifyGraphError } from "@/lib/whatsapp/errors";
import { CONFIG_COLUMNS, toPublicConfig, type ConfigRow } from "@/lib/whatsapp/config";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * Update or disconnect one market's WhatsApp credential.
 *
 * Pausing is a status flip and touches nothing else: the outbox keeps queuing
 * and stops sending. Rotating the token re-verifies it against Graph first,
 * for the same reason the initial save does. Rotating the app secret or the
 * verify token cannot be verified (Meta never returns them) and is stored as
 * typed — the staged test's webhook stage is what proves them.
 */

export const dynamic = "force-dynamic";

const GRAPH_VERSION_RE = /^v\d{2}\.\d$/;

async function handlePATCH(req: NextRequest, { params }: { params: { marketId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = createAdminClient({ actorId: actorResult.actor.id });

  const { data: existing, error: loadError } = await admin
    .from("whatsapp_configs")
    .select(CONFIG_COLUMNS)
    .eq("market_id", params.marketId)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = existing as ConfigRow;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "paused") {
      return NextResponse.json({ error: "invalid_status", message: "status must be active or paused" }, { status: 400 });
    }
    patch.status = body.status;
    patch.status_reason = null;
  }
  if (typeof body.graph_version === "string" && body.graph_version) {
    if (!GRAPH_VERSION_RE.test(body.graph_version)) {
      return NextResponse.json({ error: "invalid_graph_version" }, { status: 400 });
    }
    patch.graph_version = body.graph_version;
  }
  if (body.send_rate_per_sec !== undefined) {
    const rate = Number(body.send_rate_per_sec);
    if (!Number.isInteger(rate) || rate < 1 || rate > 80) {
      return NextResponse.json({ error: "invalid_send_rate" }, { status: 400 });
    }
    patch.send_rate_per_sec = rate;
  }
  for (const key of ["waba_id", "phone_number_id", "app_id"] as const) {
    if (typeof body[key] === "string" && (body[key] as string).trim()) {
      const v = (body[key] as string).trim();
      if (!/^\d{1,32}$/.test(v)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
      patch[key] = v;
    }
  }
  if (typeof body.app_secret === "string" && body.app_secret.trim()) {
    patch.app_secret = encrypt(body.app_secret.trim());
  }
  if (typeof body.verify_token === "string" && body.verify_token.trim()) {
    patch.verify_token = encrypt(body.verify_token.trim());
  }

  // A rotated token, or a changed number/app, is verified before it replaces
  // the working configuration.
  const newToken = typeof body.access_token === "string" && body.access_token.trim() ? body.access_token.trim() : null;
  const identityChanged = patch.phone_number_id !== undefined || patch.waba_id !== undefined || patch.app_id !== undefined;
  if (newToken || identityChanged) {
    let token = newToken;
    if (!token) {
      try {
        token = decrypt(row.access_token);
      } catch {
        return NextResponse.json(
          { error: "decrypt_failed", message: "Le jeton enregistré est illisible — saisissez-le à nouveau." },
          { status: 400 },
        );
      }
    }
    try {
      const phone = await createWhatsAppClient({
        phoneNumberId: (patch.phone_number_id as string) ?? row.phone_number_id,
        wabaId: (patch.waba_id as string) ?? row.waba_id,
        appId: (patch.app_id as string) ?? row.app_id,
        accessToken: token,
        graphVersion: (patch.graph_version as string) ?? row.graph_version,
      }).getPhoneStatus();
      patch.display_phone = phone.displayPhone;
      patch.verified_name = phone.verifiedName;
      patch.quality_rating = phone.qualityRating;
      patch.messaging_limit_tier = phone.messagingLimitTier;
      patch.last_checked_at = new Date().toISOString();
    } catch (err) {
      const cls = classifyGraphError(err);
      return NextResponse.json(
        {
          error: cls.kind === "auth" ? "invalid_token" : "meta_unreachable",
          message: err instanceof Error ? err.message : "Could not reach Meta",
          kind: cls.kind,
        },
        { status: 400 },
      );
    }
    if (newToken) patch.access_token = encrypt(newToken);
    // The stored failure described the old credential; a verified one clears it.
    if (row.status === "auth_failed" && patch.status === undefined) patch.status = "active";
    patch.status_reason = null;
    patch.last_error = null;
  }

  const { data, error } = await admin
    .from("whatsapp_configs")
    .update(patch)
    .eq("market_id", params.marketId)
    .select(CONFIG_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: toPublicConfig(data as ConfigRow) });
}

async function handleDELETE(req: NextRequest, { params }: { params: { marketId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A hard delete, deliberately: the row is configuration plus three
  // credentials, and a soft-deleted token at rest is strictly worse than none.
  // Templates, conversations and messages survive — that is history.
  const { error } = await createAdminClient({ actorId: actorResult.actor.id }).from("whatsapp_configs").delete().eq("market_id", params.marketId);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  return NextResponse.json({ data: { deleted: true } });
}

export const PATCH = withRouteErrors("/api/whatsapp/config/[marketId]", "PATCH", handlePATCH);
export const DELETE = withRouteErrors("/api/whatsapp/config/[marketId]", "DELETE", handleDELETE);
