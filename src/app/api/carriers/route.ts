import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCarriers } from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";
import {
  hasCarrierAdapter,
  adapterSupportsMarket,
  getAdapterDescriptor,
} from "@/lib/carriers/adapter-registry";
import { getAllActiveMarkets } from "@/lib/markets/list";

export const dynamic = "force-dynamic";

/**
 * Build the encrypted credentials JSON for a carrier row.
 * Accepts either a structured `credentials` object (preferred) or a legacy
 * `api_key` string. The legacy string is mapped onto the adapter's first
 * declared secret field so older form payloads keep working.
 */
function encodeCredentials(
  carrierCode: string,
  body: Record<string, unknown>
): string | null | { error: string } {
  const credsObj = body.credentials;
  if (credsObj && typeof credsObj === "object" && !Array.isArray(credsObj)) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(credsObj as Record<string, unknown>)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        flat[k] = String(v);
      }
    }
    if (Object.keys(flat).length === 0) return null;
    return encrypt(JSON.stringify(flat));
  }

  const apiKey = body.api_key;
  if (apiKey === undefined || apiKey === null || String(apiKey).length === 0) {
    return null;
  }

  const descriptor = getAdapterDescriptor(carrierCode);
  const secretKey = descriptor?.credentialFields.find((f) => f.secret)?.key;
  if (!secretKey) {
    // Custom (no-adapter) carrier — keep legacy plain-string form.
    return encrypt(String(apiKey));
  }
  return encrypt(JSON.stringify({ [secretKey]: String(apiKey) }));
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? ""
      : actor.market_id ?? "";

  // super_admin: any market. Everyone else: their own market only.
  // Agents need this for the carrier picker on the upload-to-carrier action.
  if (role !== "super_admin" && marketId !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use admin client: api_endpoint and api_credentials are REVOKE'd from authenticated role
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carriers")
    .select("id, market_id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee, is_active, created_at, updated_at")
    .eq("market_id", marketId);

  if (error) {
    console.error("[GET /api/carriers] select failed", { code: error.code, message: error.message, details: error.details });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const masked = (data ?? []).map((c) => ({
    ...c,
    api_credentials: maskCredential(c.api_credentials ?? ""),
  }));

  return NextResponse.json({ data: masked });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id: body_market_id, name, code, api_endpoint, delivery_fee, return_fee } = body as Record<string, string | number>;

  // super_admin supplies market_id in body; never use body value for market_manager
  const market_id =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : (body_market_id as string) ?? actor.market_id ?? "";

  if (!market_id || !name || !code || !api_endpoint) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const codeStr = String(code);
  if (hasCarrierAdapter(codeStr)) {
    const markets = await getAllActiveMarkets();
    const market = markets.find((m) => m.id === market_id);
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 400 });
    }
    if (!adapterSupportsMarket(codeStr, market.code)) {
      return NextResponse.json(
        { error: `Carrier "${codeStr}" is not available in this market` },
        { status: 400 }
      );
    }
  }

  const encoded = encodeCredentials(codeStr, body);
  if (encoded && typeof encoded === "object") {
    return NextResponse.json({ error: encoded.error }, { status: 400 });
  }
  const api_credentials = encoded;

  // Admin client: api_endpoint and api_credentials are REVOKE'd from authenticated role,
  // so a user-bound client cannot SELECT them back after insert.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carriers")
    .insert({
      market_id,
      name,
      code,
      api_endpoint,
      api_credentials,
      delivery_fee: delivery_fee ?? 0,
      return_fee: return_fee ?? 0,
      is_active: true,
    })
    .select("id, market_id, name, code, api_endpoint, delivery_fee, return_fee, is_active")
    .single();

  if (error) {
    console.error("[POST /api/carriers] insert failed", { code: error.code, message: error.message, details: error.details });
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Un transporteur avec le code "${codeStr}" existe déjà pour ce marché.` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
