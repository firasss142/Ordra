import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback, canManageFeedback } from "@/lib/role-permissions";
import { isComplaintStatus } from "@/lib/feedback/taxonomy";
import { isUuid, rpcErrorResponse } from "@/lib/feedback/api";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/feedback/[id] { status } — « Prendre en charge » (in_progress), « Marquer
 * résolue » (resolved), « Rouvrir » (open). Managers and super_admin; the RPC re-checks the
 * market and that the row is a validated réclamation.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canManageFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: { status?: unknown };
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!isComplaintStatus(body.status)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_feedback_complaint_status", { p_id: params.id, p_status: body.status });
  if (error) return rpcErrorResponse(error, "status");
  return NextResponse.json({ data: { id: params.id, status: body.status } });
}

/**
 * DELETE /api/feedback/[id] — the toast's « Annuler ». The author only, within ten minutes
 * (delete_customer_feedback); a soft delete that keeps the row and its journal.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canCaptureFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_customer_feedback", { p_id: params.id });
  if (error) return rpcErrorResponse(error, "delete");
  return NextResponse.json({ data: { id: params.id } });
}
