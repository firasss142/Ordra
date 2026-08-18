import { NextRequest, NextResponse } from "next/server";
import { adminWriter, rpcError } from "@/lib/investors/admin-route";
import { canDecideWithdrawal } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

/** Body: { action: 'approve'|'reject'|'paid', reference?: string, admin_note?: string }. Ledger entry only on 'paid'. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  if (!canDecideWithdrawal(g.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let b: { action?: unknown; reference?: unknown; admin_note?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(b.action ?? "");
  if (!["approve", "reject", "paid"].includes(action)) return NextResponse.json({ error: "action must be approve, reject or paid" }, { status: 400 });
  if (action === "paid" && !(typeof b.reference === "string" && b.reference.trim())) return NextResponse.json({ error: "reference is required to mark paid" }, { status: 400 });
  const { error } = await g.admin.rpc("decide_investor_withdrawal", {
    p_id: params.id, p_action: action, p_actor_id: g.actor.id, p_reference: typeof b.reference === "string" ? b.reference.trim() : null, p_admin_note: typeof b.admin_note === "string" ? b.admin_note : null,
  });
  if (error) return rpcError(error, "[POST withdrawals/[id]/decide]");
  return NextResponse.json({ data: { id: params.id, action } });
}
