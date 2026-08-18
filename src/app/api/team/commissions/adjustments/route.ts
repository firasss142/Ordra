import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCommissions } from "@/lib/role-permissions";
import { rpcErrorResponse } from "@/lib/commissions/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/commissions/adjustments  { agent_id, amount, note }
 * The only repair path for the append-only ledger. Signed amount, note required.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canManageCommissions(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agentId = typeof body.agent_id === "string" && body.agent_id ? body.agent_id : null;
  const amount = typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount !== 0 ? body.amount : null;
  const note = typeof body.note === "string" && body.note.trim().length >= 3 ? body.note.trim().slice(0, 500) : null;
  if (!agentId || amount === null || !note) {
    return NextResponse.json({ error: "agent_id, a non-zero amount and a note are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("post_agent_commission_adjustment", {
    p_agent_id: agentId,
    p_amount: amount,
    p_note: note,
  });
  if (error) return rpcErrorResponse("api/team/commissions/adjustments", error);
  return NextResponse.json({ data }, { status: 201 });
}
