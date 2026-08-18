import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCommissions } from "@/lib/role-permissions";
import { rpcErrorResponse } from "@/lib/commissions/api";
import { PAYOUT_METHODS, type PayoutMethod } from "@/lib/commissions/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/team/commissions/payouts
 * { agent_id, amount, paid_at, method, reference?, note?, allow_negative? }
 * "Enregistrer un paiement". The RPC re-checks the role and the market, folds
 * the balance and refuses to go negative unless allow_negative — the client
 * shows the warning and re-sends with the flag once the manager confirms.
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
  const amount = typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0 ? body.amount : null;
  const paidAtRaw = typeof body.paid_at === "string" ? body.paid_at : "";
  const paidAt = paidAtRaw && !Number.isNaN(Date.parse(paidAtRaw)) ? new Date(paidAtRaw).toISOString() : null;
  const method = PAYOUT_METHODS.includes(body.method as PayoutMethod) ? (body.method as PayoutMethod) : null;
  const reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim().slice(0, 200) : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const allowNegative = body.allow_negative === true;

  if (!agentId || amount === null || !paidAt || !method) {
    return NextResponse.json(
      { error: "agent_id, a positive amount, a valid paid_at and a method (cash | bank_transfer | wallet) are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_agent_payout", {
    p_agent_id: agentId,
    p_amount: amount,
    p_paid_at: paidAt,
    p_method: method,
    p_reference: reference,
    p_note: note,
    p_allow_negative: allowNegative,
  });
  if (error) return rpcErrorResponse("api/team/commissions/payouts", error);
  return NextResponse.json({ data }, { status: 201 });
}
