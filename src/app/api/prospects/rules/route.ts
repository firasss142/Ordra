import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { parseRules } from "@/lib/prospects/desk/rules";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** GET /api/prospects/rules — the market's `prospect_recovery`, merged over the SQL defaults. */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const m = deskMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in m) return m.response;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prospect_recovery_settings", { p_market_id: m.marketId });
  if (error) {
    console.error("[api/prospects/rules] read failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * PUT /api/prospects/rules — « Règles ». Validated here (lib/prospects/desk/rules.ts),
 * written by set_prospect_recovery_settings, which checks the caller again
 * and keeps the history.
 */
async function handlePUT(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const body = await req.json().catch(() => null);
  const m = deskMarket(actorResult.actor, req.nextUrl.searchParams.get("market_id") ?? (body?.market_id as string | undefined));
  if ("response" in m) return m.response;
  const { market_id: _ignored, ...rest } = (body ?? {}) as Record<string, unknown>;
  const parsed = parseRules(rest);
  if (!parsed.ok) return NextResponse.json({ error: "invalid", field: parsed.field }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_prospect_recovery_settings", { p_market_id: m.marketId, p_value: parsed.value });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[api/prospects/rules] write failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const GET = withRouteErrors("/api/prospects/rules", "GET", handleGET);
export const PUT = withRouteErrors("/api/prospects/rules", "PUT", handlePUT);
