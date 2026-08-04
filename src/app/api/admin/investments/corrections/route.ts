import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

const REPAIR_TYPES = ["correction", "reserve_release", "principal_return"] as const;
type RepairType = (typeof REPAIR_TYPES)[number];

/**
 * Post a compensating entry to the investor ledger.
 *
 * The ledger is append-only by design, so a mistake can only be repaired by a
 * new entry that cancels it. `correction` and `reserve_release` were declared
 * in the entry_type CHECK and folded by investor-balance.ts from the start,
 * but nothing could write either — which meant every ledger error in this
 * system was permanent, and the "add a correcting entry" instruction printed
 * on a failed payout referred to a route that did not exist.
 *
 * super_admin only, and the note is mandatory: an unexplained adjustment to
 * someone's money is indistinguishable from theft when read back later.
 */
export async function POST(req: NextRequest) {
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

  const investorId = String(body.investor_id ?? "");
  const entryType = String(body.entry_type ?? "") as RepairType;
  const amount = Number(body.amount);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!investorId) {
    return NextResponse.json({ error: "investor_id is required" }, { status: 400 });
  }
  if (!REPAIR_TYPES.includes(entryType)) {
    return NextResponse.json(
      { error: `entry_type must be one of ${REPAIR_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json(
      { error: "note is required — corrections must be explainable" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("post_investor_correction", {
    p_investor_id: investorId,
    p_entry_type: entryType,
    p_amount: amount,
    p_note: note.slice(0, 500),
    p_actor_id: actor.id,
    p_product_id: body.product_id ? String(body.product_id) : null,
    p_statement_id: body.statement_id ? String(body.statement_id) : null,
  });

  if (error) {
    if (error.code === "P0002" || /not found/i.test(error.message)) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 });
    }
    if (error.code === "42501") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[POST /api/admin/investments/corrections]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
