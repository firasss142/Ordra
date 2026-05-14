import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canManageStorefronts,
} from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
      "id, market_id, platform, name, config, webhook_secret, is_active, created_at, updated_at, last_webhook_received_at, last_webhook_status, last_webhook_error, webhook_failure_count"
    )
    .eq("market_id", marketId);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const masked = (data ?? []).map((s) => ({
    ...s,
    webhook_secret: maskCredential(s.webhook_secret ?? ""),
  }));

  return NextResponse.json({ data: masked });
}

export async function POST(req: NextRequest) {
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
