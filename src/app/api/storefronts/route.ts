import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canManageStorefronts,
} from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { getSheetsSources, parseSpreadsheetId, DEFAULT_SHEET_ADAPTER } from "@/lib/google-sheets/sources-config";
import { classifySheetError, getServiceAccountEmail, inspectSheet, missingHeaders } from "@/lib/google-sheets/inspect-sheet";
import { getSyncState, setLastRowForStorefront } from "@/lib/google-sheets/sync-state";
import { getSheetsAdapter } from "@/lib/storefronts/sheets/adapter-registry";

/**
 * What a shop can be created as. Each one has an adapter; anything else would
 * be a row whose every webhook is logged "Unknown platform".
 */
const CREATABLE_PLATFORMS = new Set([
  "easy_orders",
  "shopify",
  "woocommerce",
  "lightfunnels",
  "buybox",
  "google_sheets",
]);

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  const marketId =
    role === "market_manager" || role === "agent"
      ? actorMarketId
      : req.nextUrl.searchParams.get("market_id") ?? actorMarketId;

  // Agents can read storefronts for their own market (read-only, used for order creation picker)
  if (role !== "agent" && !canReadSettings(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (role === "agent" && (!actorMarketId || marketId !== actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("storefronts")
    .select(
      "id, market_id, platform, name, config, webhook_secret, is_active, created_at, updated_at, last_webhook_received_at, last_webhook_status, last_webhook_error, webhook_failure_count, auth_mode, accent_color"
    )
    .eq("market_id", marketId);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const masked = (data ?? []).map((s) => ({
    ...s,
    webhook_secret: maskCredential(s.webhook_secret ?? ""),
  }));

  return NextResponse.json({ data: masked });
}

async function handlePOST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageStorefronts(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id: body_market_id, platform, name, config, webhook_secret } = body as Record<string, unknown>;

  // super_admin supplies market_id in body; never use body value for market_manager
  const market_id =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : (body_market_id as string) ?? actor.market_id ?? "";

  if (!market_id || !platform || !name) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (typeof platform !== "string" || !CREATABLE_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "Unknown platform", code: "unknown_platform" }, { status: 400 });
  }

  if (platform === "google_sheets") {
    return createSheetShop(supabase, { market_id, name: String(name), config });
  }

  const encrypted_secret = webhook_secret
    ? encrypt(String(webhook_secret))
    : null;

  const { data, error } = await supabase
    .from("storefronts")
    .insert({
      market_id,
      platform,
      name,
      config: config ?? {},
      webhook_secret: encrypted_secret,
      is_active: true,
    })
    .select("id, market_id, platform, name, config, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data }, { status: 201 });
}

/**
 * A Converty account (or any sheet export) becomes a shop of its own.
 *
 * Checked before anything is written, because a sheet that cannot be read does
 * not fail here — it fails every fifteen minutes in a cron nobody watches. The
 * same sheet and tab twice in one market would import every row into two
 * shops, each under its own dedupe namespace, so every order would arrive twice.
 *
 * `import_from: "now"` (the default) starts the cursor under the rows already
 * there: an account connected after months of trading must not pour its whole
 * history into the agents' queue as new orders.
 */
async function createSheetShop(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { market_id: string; name: string; config: unknown },
) {
  const input = (params.config && typeof params.config === "object" ? params.config : {}) as Record<string, unknown>;
  const spreadsheetId = parseSpreadsheetId(String(input.spreadsheet ?? input.spreadsheet_id ?? ""));
  const sheetName = typeof input.sheet_name === "string" ? input.sheet_name.trim() : "";
  if (!spreadsheetId || !sheetName) {
    return NextResponse.json({ error: "A sheet link and a tab name are required", code: "invalid_sheet" }, { status: 400 });
  }

  const sheetAdapter = DEFAULT_SHEET_ADAPTER;
  const serviceAccount = getServiceAccountEmail();

  let inspection;
  try {
    inspection = await inspectSheet({ spreadsheetId, sheetName });
  } catch (err) {
    const code = classifySheetError(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err), code, service_account: serviceAccount },
      { status: 422 },
    );
  }

  const missing = missingHeaders(inspection.headers, getSheetsAdapter(sheetAdapter).requiredHeaders);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: "The sheet is missing required columns", code: "missing_columns", columns: missing },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  const existing = await getSheetsSources(admin, params.market_id);
  const taken = existing.find(
    (s) => s.spreadsheet_id === spreadsheetId && s.sheet_name.trim().toLowerCase() === sheetName.toLowerCase(),
  );
  if (taken) {
    return NextResponse.json(
      { error: "This sheet is already connected", code: "already_connected", storefront_id: taken.storefront_id },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("storefronts")
    .insert({
      market_id: params.market_id,
      platform: "google_sheets",
      name: params.name,
      config: { spreadsheet_id: spreadsheetId, sheet_name: sheetName, sheet_adapter: sheetAdapter },
      // NOT NULL in the schema. A sheet shop receives no webhook, so it holds a
      // random value nobody is ever shown; its URL has no webhook adapter anyway.
      webhook_secret: encrypt(randomBytes(32).toString("hex")),
      // Archived until its cursor is in place: the import skips archived shops,
      // so a cron tick landing in between cannot read the sheet from row 1.
      is_active: false,
    })
    .select("id, market_id, platform, name, config, is_active, created_at")
    .single();

  if (error || !data) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const id = data.id as string;
  // Always written — 0 for "all" — so that a Sheets shop with NO cursor can only
  // mean a creation that broke, and [id] PATCH can refuse to switch it on.
  const startRow = input.import_from === "all" ? 0 : inspection.dataRowCount;
  let cursorSaved = false;
  try {
    await setLastRowForStorefront(admin, params.market_id, id, startRow);
    cursorSaved = (await getSyncState(admin, params.market_id))[id]?.last_row === startRow;
  } catch {
    cursorSaved = false;
  }
  if (!cursorSaved) {
    // No orders can reference it yet: remove it rather than leave an archived
    // shop that would import the account's whole history once switched on.
    await supabase.from("storefronts").delete().eq("id", id);
    return NextResponse.json(
      { error: "The starting row could not be saved; nothing was created", code: "cursor_failed" },
      { status: 500 },
    );
  }

  const { error: activateError } = await supabase.from("storefronts").update({ is_active: true }).eq("id", id);
  if (activateError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json(
    { data: { ...data, is_active: true }, rows_existing: inspection.dataRowCount, service_account: serviceAccount },
    { status: 201 },
  );
}

export const GET = withRouteErrors("/api/storefronts", "GET", handleGET);
export const POST = withRouteErrors("/api/storefronts", "POST", handlePOST);
