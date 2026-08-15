import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { TargetMetric } from "@/lib/team/types";

export const dynamic = "force-dynamic";

const METRICS: readonly TargetMetric[] = ["daily_treated", "min_rate", "conf_per_hour", "throughput"];

/**
 * POST /api/team/targets  { agent_id, metric, value, note? }
 * The coaching CTA. Appends a per-agent target — the latest row per
 * (agent, metric) is the active one. RLS restricts writes to managers of the
 * agent's market and to super_admin; this handler mirrors that so the error
 * is a clean 403 rather than an RLS violation.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { agent_id?: unknown; metric?: unknown; value?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;
  const metric = METRICS.includes(body.metric as TargetMetric) ? (body.metric as TargetMetric) : null;
  const value = typeof body.value === "number" && Number.isFinite(body.value) && body.value >= 0 ? body.value : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (!agentId || !metric || value === null) {
    return NextResponse.json({ error: "agent_id, metric and a non-negative value are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: agent, error: agentErr } = await supabase
    .from("users")
    .select("id, role, market_id")
    .eq("id", agentId)
    .single();
  if (agentErr || !agent || agent.role !== "agent" || !agent.market_id) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (actor.role === "market_manager" && agent.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("agent_targets")
    .insert({ agent_id: agentId, market_id: agent.market_id, metric, value, note, set_by: actor.id })
    .select("id, agent_id, metric, value, created_at")
    .single();

  if (error) {
    console.error("[api/team/targets] insert failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
