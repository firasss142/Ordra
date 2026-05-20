import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { getNextLeadAttemptStatus } from "@/lib/leads/attempt-logic";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";

const ATTEMPT_STATUSES = ["attempt_1", "attempt_2", "attempt_3"] as const;

export const dynamic = "force-dynamic";

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

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { callback_time?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, status, assigned_to, market_id")
    .eq("id", id)
    .single();

  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const maxAttempts = Number(
    await getMarketSetting(
      supabase,
      lead.market_id,
      "max_lead_attempts",
      "3"
    )
  );

  const nextStatus = getNextLeadAttemptStatus(lead.status);
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Cannot log no-response from status '${lead.status}'` },
      { status: 400 }
    );
  }

  // The lead_status enum tops out at attempt_3, so we count attempt rows in
  // lead_history rather than relying on the status string — that's how this
  // route stays correct when an admin sets max_lead_attempts > 3.
  const { count: priorAttemptsRaw } = await supabase
    .from("lead_history")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", id)
    .in("status_to", ATTEMPT_STATUSES as unknown as string[]);
  const priorAttempts = priorAttemptsRaw ?? 0;
  const nextAttemptNumber = priorAttempts + 1;

  // Reject when this click would push the lead past the configured max,
  // matching the orders RPC semantic (reject on the N+1 click).
  if (nextAttemptNumber > maxAttempts) {
    const { error: lostErr } = await supabase.rpc("rpc_transition_lead_status", {
      p_lead_id: id,
      p_new_status_key: "lost",
      p_actor_id: actor.id,
      p_actor_type: "system",
      p_note: `Auto-lost: max attempts reached (tentative ${nextAttemptNumber})`,
      p_lost_reason: "unreachable",
      p_lost_note: null,
    });
    if (lostErr) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({
      data: { auto_lost: true, new_status: "lost" },
    });
  }

  // Optional callback branch
  if (body.callback_time) {
    // Transition to callback_scheduled; we also need to set callback_scheduled_at.
    // The RPC doesn't yet take a callback param for leads — update the column directly.
    const { error: cbErr } = await supabase.rpc("rpc_transition_lead_status", {
      p_lead_id: id,
      p_new_status_key: "callback_scheduled",
      p_actor_id: actor.id,
      p_actor_type: "agent",
      p_note: `Pas de réponse — rappel prévu pour ${body.callback_time}`,
      p_lost_reason: null,
      p_lost_note: null,
    });
    if (cbErr) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    await supabase
      .from("leads")
      .update({ callback_scheduled_at: body.callback_time })
      .eq("id", id);

    return NextResponse.json({
      data: { auto_lost: false, new_status: "callback_scheduled" },
    });
  }

  const { error: attemptError } = await supabase.rpc("rpc_transition_lead_status", {
    p_lead_id: id,
    p_new_status_key: nextStatus,
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: `Pas de réponse — tentative ${nextAttemptNumber}`,
    p_lost_reason: null,
    p_lost_note: null,
  });

  if (attemptError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: { auto_lost: false, new_status: nextStatus },
  });
}
