import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

const PAYOUT_METHODS = ["bank_transfer", "cash", "wallet"] as const;

/**
 * Edit an investor's commercial terms.
 *
 * Only legal_name, payout_method, payout_details and notes are editable. `id`
 * is the user id and the ledger's foreign key, so it is never patchable —
 * accepting it from the body would let one investor's terms be written onto
 * another's row. Commercial terms (share %, capital, cadence, maturity) live on
 * the DEAL (investor_deal_terms), not on the profile.
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

  const patch: Record<string, unknown> = {};

  if (body.legal_name !== undefined) {
    const legalName = typeof body.legal_name === "string" ? body.legal_name.trim() : "";
    if (!legalName) {
      return NextResponse.json({ error: "legal_name cannot be empty" }, { status: 400 });
    }
    patch.legal_name = legalName.slice(0, 200);
  }

  if (body.payout_method !== undefined) {
    const method = String(body.payout_method);
    if (!PAYOUT_METHODS.includes(method as (typeof PAYOUT_METHODS)[number])) {
      return NextResponse.json(
        { error: `payout_method must be one of ${PAYOUT_METHODS.join(", ")}` },
        { status: 400 }
      );
    }
    patch.payout_method = method;
  }


  if (body.payout_details !== undefined) patch.payout_details = body.payout_details;
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("investors")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Investor not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("investors")
    .update(patch)
    .eq("id", id)
    .select("id, legal_name, payout_method, payout_details, notes")
    .single();

  if (error) {
    console.error("[PATCH /api/admin/investments/investors/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
