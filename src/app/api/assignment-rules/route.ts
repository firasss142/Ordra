import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { AssignmentAlgorithm } from "@/types/settings";

export const dynamic = "force-dynamic";

const VALID_ALGORITHMS = new Set<string>(Object.values(AssignmentAlgorithm));

function resolveMarketId(req: NextRequest, actorRole: string, actorMarketId: string): string {
  if (actorRole === "super_admin") {
    return req.nextUrl.searchParams.get("market_id") ?? actorMarketId;
  }
  return actorMarketId;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const actorMarketId = actor.market_id ?? "";
  const marketId = resolveMarketId(req, actor.role, actorMarketId);

  if (!canAssignOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("assignment_rules")
    .select("algorithm, config, is_active")
    .eq("market_id", marketId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Default row when none exists yet
  const rule = data ?? { algorithm: "manual", config: null, is_active: false };
  return NextResponse.json({ data: rule });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    actor.role === "super_admin"
      ? (body.market_id as string | undefined) ?? actorMarketId
      : actorMarketId;

  if (!canAssignOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const algorithm = body.algorithm as string | undefined;
  if (algorithm !== undefined && !VALID_ALGORITHMS.has(algorithm)) {
    return NextResponse.json({ error: "Invalid algorithm" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (algorithm !== undefined) updates.algorithm = algorithm;
  if (body.config !== undefined) updates.config = body.config;
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

  // Upsert assignment_rules for this market
  const { data: ruleData, error: ruleErr } = await supabase
    .from("assignment_rules")
    .upsert({ market_id: marketId, ...updates }, { onConflict: "market_id" })
    .select("algorithm, config, is_active")
    .single();

  if (ruleErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Keep settings.assignment_algorithm in sync — single source of truth for tryAutoAssign
  if (algorithm !== undefined) {
    await supabase
      .from("settings")
      .upsert(
        {
          market_id: marketId,
          key: "assignment_algorithm",
          value: { type: algorithm },
        },
        { onConflict: "market_id,key" }
      );
  }

  return NextResponse.json({ data: ruleData });
}
