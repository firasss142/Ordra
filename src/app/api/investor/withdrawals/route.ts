import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canRequestWithdrawal } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";
import { toMillimes } from "@/lib/calculations/math";

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

  const portfolio = await loadPortfolio(admin, actor.id);
  if (!portfolio) {
    return NextResponse.json({ error: "Investor profile not found" }, { status: 404 });
  }

  // Any already-requested amount is reserved against the balance, so an
  // investor cannot queue several requests that jointly exceed what they have.
  const { data: openRequests } = await admin
    .from("withdrawal_requests")
    .select("amount")
    .eq("investor_id", actor.id)
    .in("status", ["requested", "approved"]);

  const alreadyClaimed = (openRequests ?? []).reduce(
    (acc, r) => acc + toMillimes(Number(r.amount)),
    0
  );
  const availableMillimes = toMillimes(portfolio.balance.available) - alreadyClaimed;

  if (toMillimes(amount) > availableMillimes) {
    return NextResponse.json(
      {
        error: "Amount exceeds available balance",
        available: portfolio.balance.available,
        pendingRequests: alreadyClaimed / 1000,
      },
      { status: 422 }
    );
  }

  const { data, error } = await admin
    .from("withdrawal_requests")
    .insert({
      investor_id: actor.id,
      market_id: portfolio.marketId,
      amount,
      status: "requested",
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
    })
    .select("id, amount, status, requested_at")
    .single();

  if (error) {
    console.error("[POST /api/investor/withdrawals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
