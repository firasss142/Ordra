import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canRequestWithdrawal } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

/** The investor's own withdrawal history. */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canRequestWithdrawal(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("withdrawal_requests")
    .select("id, amount, status, requested_at, decided_at, paid_at, payout_reference, note")
    .eq("investor_id", actor.id)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("[GET /api/investor/withdrawals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

/**
 * Request a withdrawal.
 *
 * Withdrawable means SETTLED and released — `balance.available`. Pending
 * accruals and the held reserve are deliberately excluded: pending is still
 * recomputed from live costs and can move, and the reserve exists precisely to
 * absorb returns that land after a period closes. Paying either out early is
 * how a business ends up trying to claw money back.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canRequestWithdrawal(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { amount?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Delegated to request_withdrawal, which takes a row lock on the investor,
  // recomputes the available balance from the ledger and inserts — all in one
  // transaction.
  //
  // This used to be a read-then-write across three separate statements with no
  // lock and no constraint, so two concurrent requests both passed the balance
  // check and both inserted. Approving each then wrote two `withdrawal` ledger
  // entries and the balance went negative. The investor_id comes from the
  // session, never the body.
  const { data, error } = await admin.rpc("request_withdrawal", {
    p_investor_id: actor.id,
    p_amount: amount,
    p_note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
  });

  if (error) {
    // check_violation = the RPC's own balance/amount guards.
    if (error.code === "23514" || /exceeds available balance/i.test(error.message)) {
      return NextResponse.json(
        { error: "AMOUNT_EXCEEDS_AVAILABLE", detail: error.details ?? error.message },
        { status: 422 }
      );
    }
    if (error.code === "P0002" || /not found/i.test(error.message)) {
      return NextResponse.json({ error: "Investor profile not found" }, { status: 404 });
    }
    console.error("[POST /api/investor/withdrawals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
