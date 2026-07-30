import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canDecideWithdrawal } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

type Action = "approve" | "reject" | "mark_paid";

/**
 * Approve, reject, or mark a withdrawal paid.
 *
 * The ledger entry is written only on `mark_paid`, when money has actually
 * left. Approving is an intent, not a movement — writing the entry at approval
 * would understate the available balance while the transfer is still pending,
 * and the ledger is append-only so it could not be walked back if the payment
 * later failed.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canDecideWithdrawal(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: unknown; payout_reference?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action as Action;
  if (!["approve", "reject", "mark_paid"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: request } = await admin
    .from("withdrawal_requests")
    .select("id, investor_id, market_id, amount, status")
    .eq("id", id)
    .single();

  if (!request) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Legal transitions: requested -> approved|rejected, approved -> paid.
  const allowed: Record<Action, string[]> = {
    approve: ["requested"],
    reject: ["requested", "approved"],
    mark_paid: ["approved"],
  };

  if (!allowed[action].includes(request.status)) {
    return NextResponse.json(
      { error: `Cannot ${action} a withdrawal that is ${request.status}` },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    decided_at: now,
    decided_by: actor.id,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
  };

  if (action === "approve") patch.status = "approved";
  if (action === "reject") patch.status = "rejected";
  if (action === "mark_paid") {
    patch.status = "paid";
    patch.paid_at = now;
    patch.payout_reference =
      typeof body.payout_reference === "string" ? body.payout_reference.slice(0, 200) : null;
  }

  const { error: updateError } = await admin
    .from("withdrawal_requests")
    .update(patch)
    .eq("id", id)
    // Guard against two admins deciding the same request concurrently.
    .eq("status", request.status);

  if (updateError) {
    console.error("[PATCH /api/admin/investments/withdrawals]", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  if (action === "mark_paid") {
    const { error: ledgerError } = await admin.from("investor_ledger").insert({
      investor_id: request.investor_id,
      market_id: request.market_id,
      entry_type: "withdrawal",
      amount: request.amount,
      note: `Withdrawal paid${patch.payout_reference ? ` (ref ${patch.payout_reference})` : ""}`,
      created_by: actor.id,
    });

    if (ledgerError) {
      // The row is already marked paid. Surface loudly rather than silently
      // leaving the balance overstated — the ledger cannot be edited later.
      console.error(
        "[PATCH /api/admin/investments/withdrawals] ledger insert FAILED after marking paid:",
        ledgerError
      );
      return NextResponse.json(
        {
          error:
            "Withdrawal marked paid but the ledger entry failed. The balance is overstated — add a correcting entry before further payouts.",
          detail: ledgerError.message,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, status: patch.status });
}
