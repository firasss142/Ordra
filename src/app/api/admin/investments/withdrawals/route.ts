import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewInvestorAdmin } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

const STATUSES = ["requested", "approved", "rejected", "paid"] as const;

/**
 * The withdrawal approval queue.
 *
 * PATCH .../withdrawals/[id] could already approve, reject and mark paid, but
 * nothing could LIST requests — so an investor could ask for money and no
 * operator had any surface on which to see it. Requests sat untouched with the
 * investor's balance held against them.
 *
 * ?status=requested,approved narrows the queue; anything unrecognised is
 * ignored rather than silently returning an empty list, because "no pending
 * payouts" is a dangerous thing to display when it is not true.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewInvestorAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  let query = admin
    .from("withdrawal_requests")
    .select(
      "id, investor_id, market_id, amount, status, requested_at, decided_at, paid_at, payout_reference, note, investors(legal_name)"
    )
    .order("requested_at", { ascending: false })
    .limit(200);

  const requested = (req.nextUrl.searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is (typeof STATUSES)[number] =>
      STATUSES.includes(s as (typeof STATUSES)[number])
    );

  if (requested.length > 0) {
    query = query.in("status", requested);
  }

  // A market_manager sees only their own market's requests.
  if (actor.role === "market_manager") {
    query = query.eq("market_id", actor.market_id ?? "");
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/admin/investments/withdrawals]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
