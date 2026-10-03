import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadAllConfigs, type WhatsAppConfig } from "@/lib/whatsapp/config";
import { parseWebhookPayload } from "@/lib/whatsapp/webhook/parse";
import { verifyTokenMatches, verifyWebhookSignature } from "@/lib/whatsapp/webhook/verify";
import { handleWebhookEvents } from "@/lib/whatsapp/webhook/handle";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * Meta → Ordra. One callback URL serves both Business Portfolios: the payload
 * names the receiving phone number (message traffic) or the WABA (template
 * and quality events), and that picks the market's credential.
 *
 * Response codes are a contract with Meta's retry policy:
 *   200 — anything Meta must NOT retry: processed, ignored, unparseable.
 *   401 — a signature that matches no resolved market. Meta retries these,
 *         so a mis-entered app secret loses no events once corrected, and a
 *         forged request is never acknowledged.
 *   403 — a failed GET handshake.
 * The body is read ONCE as raw text; the HMAC covers those exact bytes.
 */

export const dynamic = "force-dynamic";

interface LogInput {
  event: string;
  payload: unknown;
  status: "processed" | "ignored" | "error";
  errorMessage?: string | null;
}

async function log(admin: ReturnType<typeof createAdminClient>, input: LogInput): Promise<void> {
  try {
    await admin.from("webhook_delivery_log").insert({
      source: "whatsapp",
      event: input.event,
      payload: (input.payload ?? {}) as Record<string, unknown>,
      status: input.status,
      error_message: input.errorMessage ?? null,
    });
  } catch {
    /* best effort: a log failure never changes the response */
  }
}

async function handleGET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const admin = createAdminClient();

  let matched = false;
  if (mode === "subscribe" && token && challenge) {
    try {
      const configs = await loadAllConfigs(admin);
      matched = configs.some((c) => !c.decryptFailed && verifyTokenMatches(token, c.verifyToken));
    } catch {
      matched = false;
    }
  }

  await log(admin, {
    event: "verify",
    payload: { mode, has_token: Boolean(token) },
    status: matched ? "processed" : "error",
    errorMessage: matched ? null : "verify token did not match any market",
  });

  if (!matched) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function handlePOST(req: NextRequest) {
  const admin = createAdminClient();
  const raw = await req.text();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    await log(admin, { event: "invalid_json", payload: { raw: raw.slice(0, 2000) }, status: "error", errorMessage: "invalid JSON" });
    return NextResponse.json({ received: false }, { status: 200 });
  }

  const parsed = parseWebhookPayload(json);
  if (!parsed.ok) {
    await log(admin, { event: "not_whatsapp", payload: json, status: "ignored", errorMessage: "object is not whatsapp_business_account" });
    return NextResponse.json({ received: false }, { status: 200 });
  }

  let configs: WhatsAppConfig[];
  try {
    configs = (await loadAllConfigs(admin)).filter((c) => !c.decryptFailed);
  } catch (err) {
    await log(admin, { event: "config_unavailable", payload: json, status: "error", errorMessage: err instanceof Error ? err.message : "config read failed" });
    // Our fault, not Meta's: a 500 makes Meta retry once the DB is back.
    return NextResponse.json({ error: "config unavailable" }, { status: 500 });
  }

  const resolved = configs.filter((c) => parsed.phoneNumberIds.includes(c.phoneNumberId) || parsed.wabaIds.includes(c.wabaId));
  if (resolved.length === 0) {
    await log(admin, {
      event: "unknown_source",
      payload: json,
      status: "ignored",
      errorMessage: `unknown_source phone=${parsed.phoneNumberIds.join(",")} waba=${parsed.wabaIds.join(",")}`,
    });
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  const signature = req.headers.get("x-hub-signature-256");
  const signed = resolved.some((c) => c.appSecret && verifyWebhookSignature(raw, signature, c.appSecret));
  if (!signed) {
    await log(admin, { event: "bad_signature", payload: json, status: "error", errorMessage: "X-Hub-Signature-256 did not match the market's app secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await handleWebhookEvents(parsed.events, {
    admin,
    configsByPhone: new Map(configs.map((c) => [c.phoneNumberId, c])),
    configsByWaba: new Map(configs.map((c) => [c.wabaId, c])),
  });

  const kinds = Array.from(new Set(parsed.events.map((e) => e.type))).join("+") || "empty";
  await log(admin, {
    event: kinds,
    payload: json,
    status: summary.errors.length > 0 ? "error" : summary.processed > 0 ? "processed" : "ignored",
    errorMessage:
      summary.errors.length > 0
        ? summary.errors.map((e) => `${e.event}: ${e.message}`).join(" | ").slice(0, 1000)
        : summary.notes.length > 0
          ? summary.notes.join(", ").slice(0, 1000)
          : null,
  });

  return NextResponse.json(
    { received: true, events: parsed.events.length, processed: summary.processed, ignored: summary.ignored, errors: summary.errors.length },
    { status: 200 },
  );
}

export const GET = withRouteErrors("/api/webhooks/whatsapp", "GET", handleGET);
export const POST = withRouteErrors("/api/webhooks/whatsapp", "POST", handlePOST);
