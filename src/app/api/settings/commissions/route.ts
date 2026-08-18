import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canSetCommissionRates } from "@/lib/role-permissions";
import { ISO_DAY, rpcErrorResponse } from "@/lib/commissions/api";
import type { CommissionSettings } from "@/lib/commissions/types";

export const dynamic = "force-dynamic";

/** GET /api/settings/commissions?market_id=… — Paramètres › Général › Commissions (super_admin). */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canSetCommissionRates(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) return NextResponse.json({ error: "market_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_commission_settings", { p_market_id: marketId });
  if (error) return rpcErrorResponse("api/settings/commissions", error);
  return NextResponse.json({ data: (data ?? {}) as CommissionSettings });
}

/**
 * POST /api/settings/commissions
 * { market_id, agent_id?: string|null, amount, enabled, effective_from, note? }
 * One call for a rate change AND for the on/off switch: it closes the open row
 * for (market, agent-or-null) at effective_from and inserts the new one.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canSetCommissionRates(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const marketId = typeof body.market_id === "string" && body.market_id ? body.market_id : null;
  const agentId = typeof body.agent_id === "string" && body.agent_id ? body.agent_id : null;
  const amount = typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount >= 0 ? body.amount : null;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  const effectiveFrom = typeof body.effective_from === "string" && ISO_DAY.test(body.effective_from) ? body.effective_from : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  if (!marketId || amount === null || !effectiveFrom) {
    return NextResponse.json({ error: "market_id, a non-negative amount and effective_from (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_agent_commission_rate", {
    p_market_id: marketId,
    p_agent_id: agentId,
    p_amount: amount,
    p_enabled: enabled,
    p_effective_from: effectiveFrom,
    p_note: note,
  });
  if (error) return rpcErrorResponse("api/settings/commissions", error);
  return NextResponse.json({ data }, { status: 201 });
}
