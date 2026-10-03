import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { encrypt } from "@/lib/crypto";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { classifyGraphError } from "@/lib/whatsapp/errors";
import {
  CONFIG_COLUMNS,
  CONFIG_LAST_TEST_COLUMNS,
  generateVerifyToken,
  loadTemplateCounts,
  toPublicConfig,
  type ConfigRow,
} from "@/lib/whatsapp/config";
import { marketIdToCode } from "@/lib/markets";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * The WhatsApp Cloud API credential per market, and the card that shows it.
 *
 * `whatsapp_configs` has RLS on with zero policies and no grants to
 * `authenticated`: the token can message every customer of a market and the
 * app secret authenticates Meta's webhooks. It is reachable only through the
 * service role, only here. The plaintext leaves the browser exactly once, on
 * the POST that stores it, and is never sent back: reads return a mask.
 *
 * The credential set is verified against Graph BEFORE it is written — a set
 * that fails on save is a five-second problem; one that fails at 03:07 is a
 * shipped order whose customer never heard from us.
 */

export const dynamic = "force-dynamic";

const GRAPH_VERSION_RE = /^v\d{2}\.\d$/;

function pick(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  // The card also shows the last staged test (persisted by …/test), so the
  // five-stage checklist is still there after a reload. It holds no secret;
  // toPublicConfig still strips the three that the row carries.
  let query = admin.from("whatsapp_configs").select(`${CONFIG_COLUMNS}, ${CONFIG_LAST_TEST_COLUMNS}`);
  if (actor.role === "market_manager") {
    if (!actor.market_id) return NextResponse.json({ data: [] });
    query = query.eq("market_id", actor.market_id);
  }
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const rows = (data ?? []) as ConfigRow[];
  const marketIds = rows.map((r) => r.market_id);
  const [counts, automation] = await Promise.all([loadTemplateCounts(admin, marketIds), loadAutomationSummary(admin, marketIds)]);

  return NextResponse.json({
    data: rows.map((row) => ({ ...toPublicConfig(row), templates: counts[row.market_id], automation: automation[row.market_id] })),
  });
}

interface AutomationSummary {
  enabled: boolean;
  queued: number;
  sending: number;
  last_run: { started_at: string; finished_at: string | null; status: string; sent: number; failed: number } | null;
  cron: { schedule: string; active: boolean } | null;
}

/** The "Envois automatiques" line of the card: is the switch on, is anything waiting, did the drain run. */
async function loadAutomationSummary(admin: ReturnType<typeof createAdminClient>, marketIds: string[]): Promise<Record<string, AutomationSummary>> {
  const out: Record<string, AutomationSummary> = {};
  for (const id of marketIds) out[id] = { enabled: false, queued: 0, sending: 0, last_run: null, cron: null };
  if (marketIds.length === 0) return out;
  const [settingsRes, outboxRes, runRes, cronRes] = await Promise.all([
    admin.from("settings").select("market_id, value").eq("key", "whatsapp_lifecycle_enabled").in("market_id", marketIds),
    admin.from("whatsapp_outbox").select("market_id, status").in("market_id", marketIds).in("status", ["queued", "sending"]),
    admin.from("whatsapp_outbox_runs").select("started_at, finished_at, status, sent, failed").order("started_at", { ascending: false }).limit(1),
    admin.rpc("whatsapp_outbox_cron_status"),
  ]);
  for (const r of (settingsRes.data ?? []) as { market_id: string; value: unknown }[]) {
    const v = r.value;
    const raw = v && typeof v === "object" && "value" in (v as Record<string, unknown>) ? (v as { value: unknown }).value : v;
    if (out[r.market_id]) out[r.market_id].enabled = raw === true || raw === "true";
  }
  for (const r of (outboxRes.data ?? []) as { market_id: string; status: string }[]) {
    const b = out[r.market_id];
    if (!b) continue;
    if (r.status === "queued") b.queued++;
    else if (r.status === "sending") b.sending++;
  }
  const lastRun = ((runRes.data ?? []) as AutomationSummary["last_run"][])[0] ?? null;
  const cronRow = Array.isArray(cronRes.data) ? (cronRes.data[0] as { schedule: string; active: boolean } | undefined) ?? null : null;
  for (const id of marketIds) {
    out[id].last_run = lastRun;
    out[id].cron = cronRow;
  }
  return out;
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const marketId = pick(body, "market_id");
  const wabaId = pick(body, "waba_id");
  const phoneNumberId = pick(body, "phone_number_id");
  const appId = pick(body, "app_id");
  const accessToken = pick(body, "access_token");
  const appSecret = pick(body, "app_secret");
  const graphVersion = pick(body, "graph_version");
  let verifyToken = pick(body, "verify_token");

  if (!marketId || !wabaId || !phoneNumberId || !appId || !accessToken || !appSecret) {
    return NextResponse.json(
      { error: "market_id, waba_id, phone_number_id, app_id, access_token and app_secret are required" },
      { status: 400 },
    );
  }
  if (!/^\d{1,32}$/.test(wabaId) || !/^\d{1,32}$/.test(phoneNumberId) || !/^\d{1,32}$/.test(appId)) {
    return NextResponse.json(
      { error: "invalid_id", message: "WABA ID, Phone number ID et App ID sont numériques." },
      { status: 400 },
    );
  }
  if (graphVersion && !GRAPH_VERSION_RE.test(graphVersion)) {
    return NextResponse.json({ error: "invalid_graph_version" }, { status: 400 });
  }
  const rateRaw = body.send_rate_per_sec;
  const sendRate = rateRaw === undefined || rateRaw === null || rateRaw === "" ? undefined : Number(rateRaw);
  if (sendRate !== undefined && (!Number.isInteger(sendRate) || sendRate < 1 || sendRate > 80)) {
    return NextResponse.json({ error: "invalid_send_rate" }, { status: 400 });
  }

  if (!verifyToken) verifyToken = generateVerifyToken(marketIdToCode(marketId) ?? "wa");

  // Verify before storing. Reading the phone number proves the token, the
  // phone number id AND that the token's system user is assigned to this
  // number — the three things that go wrong on a fresh setup.
  let phone;
  try {
    phone = await createWhatsAppClient({
      phoneNumberId,
      wabaId,
      appId,
      accessToken,
      graphVersion: graphVersion || undefined,
    }).getPhoneStatus();
  } catch (err) {
    const cls = classifyGraphError(err);
    return NextResponse.json(
      {
        error: cls.kind === "auth" ? "invalid_token" : cls.kind === "invalid_request" ? "invalid_request" : "meta_unreachable",
        message: err instanceof Error ? err.message : "Could not reach Meta",
        kind: cls.kind,
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_configs")
    .upsert(
      {
        market_id: marketId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        app_id: appId,
        graph_version: graphVersion || undefined,
        access_token: encrypt(accessToken),
        app_secret: encrypt(appSecret),
        verify_token: encrypt(verifyToken),
        display_phone: phone.displayPhone,
        verified_name: phone.verifiedName,
        quality_rating: phone.qualityRating,
        messaging_limit_tier: phone.messagingLimitTier,
        send_rate_per_sec: sendRate,
        status: "active",
        status_reason: null,
        last_error: null,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "market_id" },
    )
    .select(CONFIG_COLUMNS)
    .single();

  if (error || !data) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "phone_number_in_use", message: "Ce Phone number ID est déjà relié à un autre marché." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: toPublicConfig(data as ConfigRow) }, { status: 201 });
}

export const GET = withRouteErrors("/api/whatsapp/config", "GET", handleGET);
export const POST = withRouteErrors("/api/whatsapp/config", "POST", handlePOST);
