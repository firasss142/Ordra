import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { canRequestWithdrawal } from "@/lib/investor-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  try {
    const [rows, avail, claims] = await Promise.all([
      fetchAllRows(g.admin.from("investor_withdrawals").select("id, amount, currency, status, note, admin_note, requested_at, decided_at, paid_at, payout_reference").eq("investor_id", g.actor.id).order("requested_at", { ascending: false })),
      g.admin.rpc("investor_available_balance", { p_investor_id: g.actor.id }),
      g.admin.rpc("investor_open_withdrawal_claims", { p_investor_id: g.actor.id }),
    ]);
    const available = Number(avail.data ?? 0);
    const open = Number(claims.data ?? 0);
    return NextResponse.json({ data: rows, balance: { available, open_claims: open, available_for_request: Math.max(0, available - open) } }, { headers: INVESTOR_CACHE });
  } catch (e) {
    console.error("[GET /api/investor/withdrawals]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Body: { amount: number, note?: string }. The RPC enforces available − open claims. */
export async function POST(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  if (!canRequestWithdrawal(g.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { amount?: unknown; note?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  const { data, error } = await g.admin.rpc("request_investor_withdrawal", { p_investor_id: g.actor.id, p_amount: Math.round(amount * 1000) / 1000, p_note: note });
  if (error) {
    if (error.message.includes("INSUFFICIENT_AVAILABLE")) return NextResponse.json({ error: "Insufficient available balance", code: "INSUFFICIENT_AVAILABLE", detail: error.details ?? null }, { status: 422 });
    console.error("[POST /api/investor/withdrawals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
