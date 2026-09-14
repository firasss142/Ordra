import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectWorklist } from "@/lib/role-permissions";
import { LEAD_LOST_REASONS, type LeadLostReason, type LeadStatus } from "@/types/lead";
import { attemptCount } from "@/lib/prospects/worklist";

export const dynamic = "force-dynamic";

/**
 * POST /api/prospects/[id]/outcome — what happened on the call.
 *
 * The four outcomes of the prototype's sheet, minus "veut commander": that one
 * is a conversion, handled by /api/leads/[id]/convert, because it creates an
 * order rather than moving a prospect.
 *
 * Every outcome appends to `lead_history`. The status update and the history
 * row are two writes, and the history is written second: a prospect whose
 * status moved but whose trail is missing is recoverable, one whose trail
 * claims a move that never happened is not.
 *
 * Design: prototypes/prospects-v3.html (screen 3).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectWorklist(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "no_answer" && kind !== "callback" && kind !== "lost") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: lead, error: readError } = await supabase
    .from("leads")
    .select("id, market_id, status, assigned_to")
    .eq("id", params.id)
    .single();

  if (readError || !lead) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // RLS already scopes the read, but a market manager and an agent are both
  // inside it; only the owner of a prospect may say what happened on its call.
  if (actor.market_id && lead.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "agent" && lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = lead.status as LeadStatus;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let to: LeadStatus;

  if (kind === "no_answer") {
    // The enum stops at attempt_3; a fourth failed call is still attempt_3.
    const n = Math.min(3, attemptCount({ status: from }) + 1);
    to = `attempt_${n}` as LeadStatus;
    patch.status = to;
    patch.callback_scheduled_at = null;
  } else if (kind === "callback") {
    const at = body.at;
    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
      return NextResponse.json({ error: "invalid_callback_time" }, { status: 400 });
    }
    to = "callback_scheduled";
    patch.status = to;
    patch.callback_scheduled_at = at;
  } else {
    const reason = body.reason;
    if (typeof reason !== "string" || !LEAD_LOST_REASONS.includes(reason as LeadLostReason)) {
      return NextResponse.json({ error: "invalid_lost_reason" }, { status: 400 });
    }
    to = "lost";
    patch.status = to;
    patch.lost_reason = reason;
    patch.callback_scheduled_at = null;
  }

  const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
  if (note && kind === "lost") patch.lost_note = note;

  const { error: writeError } = await supabase.from("leads").update(patch).eq("id", params.id);
  if (writeError) {
    console.error("[api/prospects/outcome] update failed", writeError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const { error: historyError } = await supabase.from("lead_history").insert({
    lead_id: params.id,
    status_from: from,
    status_to: to,
    actor_id: actor.id,
    actor_type: actor.role === "agent" ? "agent" : "manager",
    note,
  });
  if (historyError) {
    // The prospect moved; only its trail is missing. Say so rather than
    // reporting a failure the agent would redo, moving it twice.
    console.error("[api/prospects/outcome] history insert failed", historyError);
  }

  return NextResponse.json({ data: { id: params.id, status: to } });
}
