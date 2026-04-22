import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canTransitionLead } from "@/lib/lead-permissions";
import { transitionLeadStatus } from "@/lib/leads/transition";
import type { LeadStatus, LeadLostReason, LeadActorType } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  let body: {
    new_status?: LeadStatus;
    note?: string;
    lost_reason?: LeadLostReason;
    lost_note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.new_status) {
    return NextResponse.json(
      { error: "new_status is required" },
      { status: 400 }
    );
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, status, assigned_to, market_id")
    .eq("id", id)
    .single();
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (role === "agent" && lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  if (
    role === "market_manager" &&
    lead.market_id !== (actor.market_id ?? "")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canTransitionLead(role, lead.status as LeadStatus, body.new_status)) {
    return NextResponse.json(
      { error: `Invalid transition from ${lead.status} to ${body.new_status}` },
      { status: 409 }
    );
  }

  const actorType: LeadActorType =
    role === "agent" ? "agent" : "manager";

  try {
    const result = await transitionLeadStatus(supabase, {
      leadId: id,
      newStatus: body.new_status as Exclude<LeadStatus, "won">,
      actorId: actor.id,
      actorType,
      note: body.note,
      lostReason: body.lost_reason,
      lostNote: body.lost_note,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = /required|must be|invalid/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
