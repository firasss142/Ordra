import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { UUID_RE } from "@/lib/investors/admin-route";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/prospects/desk/assign — « Réassigner »: these prospects go to this
 * agent. A manager's explicit choice, so no daily cap applies (the old console
 * routed it through the distribution planner, whose cap minus today's calls
 * left most agents with room 0 — it assigned nobody and toasted success).
 * bulk_assign_leads checks the caller, the market of every lead and of the
 * agent (20261006100000).
 */
async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const body = (await req.json().catch(() => null)) as { lead_ids?: unknown; agent_id?: unknown; market_id?: string } | null;
  const m = deskMarket(actorResult.actor, body?.market_id);
  if ("response" in m) return m.response;

  const ids = Array.isArray(body?.lead_ids) ? [...new Set(body!.lead_ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))] : [];
  const agentId = typeof body?.agent_id === "string" && UUID_RE.test(body.agent_id) ? body.agent_id : null;
  if (!ids.length || ids.length > 500 || !agentId) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_assign_leads", {
    p_market_id: m.marketId,
    p_assignments: ids.map((id) => ({ lead_id: id, agent_id: agentId })),
    p_actor_id: null,
    p_actor_type: "manager",
  });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("[api/prospects/desk/assign] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/prospects/desk/assign", "POST", handlePOST);
