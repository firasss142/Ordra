import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canManageCarriers,
} from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";
import {
  hasCarrierAdapter,
  adapterSupportsMarket,
} from "@/lib/carriers/adapter-registry";
import { getAllActiveMarkets } from "@/lib/markets/list";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const marketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "";

  if (!canReadSettings(role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Use admin client: api_endpoint and api_credentials are REVOKE'd from authenticated role
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carriers")
    .select("id, market_id, name, code, api_endpoint, api_credentials, delivery_fee, return_fee, is_active, created_at, updated_at")
    .eq("market_id", marketId);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const masked = (data ?? []).map((c) => ({
    ...c,
    api_credentials: maskCredential(c.api_credentials ?? ""),
  }));

  return NextResponse.json({ data: masked });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

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

  const { market_id: body_market_id, name, code, api_endpoint, api_key, delivery_fee, return_fee } = body as Record<string, string | number>;

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

  const api_credentials = api_key ? encrypt(String(api_key)) : null;

  const { data, error } = await supabase
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

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data }, { status: 201 });
}
