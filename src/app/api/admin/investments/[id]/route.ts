import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Close a capital position by end-dating it.
 *
 * CLOSING IS THE ONLY EDIT. A position's `amount`, `investor_id`, `product_id`
 * and `effective_from` are historical inputs to settlements that may already be
 * paid: allocation is capital-weighted over the period, so changing any of them
 * retroactively alters what somebody was owed for a period whose money has
 * already moved. The ledger is append-only, so that could not be undone.
 *
 * End-dating is safe by construction — settled statements snapshot
 * `investor_capital` and `total_capital`, so a close only affects periods
 * settled from here on.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageInvestments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const effectiveTo = body.effective_to === undefined ? "" : String(body.effective_to);

  if (!effectiveTo) {
    return NextResponse.json({ error: "effective_to is required" }, { status: 400 });
  }
  if (!ISO_DATE.test(effectiveTo)) {
    return NextResponse.json({ error: "effective_to must be YYYY-MM-DD" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: position } = await admin
    .from("investment_positions")
    .select("id, investor_id, product_id, market_id, amount, effective_from, effective_to, status")
    .eq("id", id)
    .maybeSingle();

  if (!position) {
    return NextResponse.json({ error: "Position not found" }, { status: 404 });
  }

  if (position.status === "closed") {
    return NextResponse.json(
      {
        error: "This position is already closed.",
        detail: `Closed as of ${position.effective_to ?? "an earlier date"}.`,
      },
      { status: 409 }
    );
  }

  // Mirrors chk_position_period, so a bad range fails with an explanation
  // instead of a raw constraint violation.
  if (effectiveTo < String(position.effective_from)) {
    return NextResponse.json(
      {
        error: "effective_to precedes effective_from",
        detail: `The position opened on ${position.effective_from}.`,
      },
      { status: 422 }
    );
  }

  const { data, error } = await admin
    .from("investment_positions")
    .update({ effective_to: effectiveTo, status: "closed" })
    .eq("id", id)
    // Guard against two admins closing the same position concurrently.
    .eq("status", "active")
    .select("id, investor_id, product_id, amount, effective_from, effective_to, status")
    .single();

  if (error) {
    console.error("[PATCH /api/admin/investments/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
