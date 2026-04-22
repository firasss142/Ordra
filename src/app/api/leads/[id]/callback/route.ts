import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  let body: { callback_time?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.callback_time) {
    return NextResponse.json(
      { error: "callback_time is required" },
      { status: 400 }
    );
  }

  const cbDate = new Date(body.callback_time);
  if (Number.isNaN(cbDate.getTime())) {
    return NextResponse.json(
      { error: "callback_time must be a valid ISO timestamp" },
      { status: 400 }
    );
  }

  if (cbDate.getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "callback_time must be in the future" },
      { status: 400 }
    );
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, status, assigned_to")
    .eq("id", id)
    .single();
  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (role === "agent" && lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const { error: rpcError } = await supabase.rpc("transition_lead_status", {
    p_lead_id: id,
    p_new_status: "callback_scheduled",
    p_actor_id: actor.id,
    p_actor_type: role === "agent" ? "agent" : "manager",
    p_note: body.note ?? `Rappel prévu pour ${body.callback_time}`,
    p_lost_reason: null,
    p_lost_note: null,
  });

  if (rpcError) {
    return NextResponse.json(
      { error: rpcError.message ?? "Internal server error" },
      { status: 500 }
    );
  }

  await supabase
    .from("leads")
    .update({ callback_scheduled_at: body.callback_time })
    .eq("id", id);

  return NextResponse.json({
    data: { new_status: "callback_scheduled", callback_scheduled_at: body.callback_time },
  });
}
