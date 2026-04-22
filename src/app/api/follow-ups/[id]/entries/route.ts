import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAppendEntry } from "@/lib/follow-up-permissions";
import type { FollowUpActorType } from "@/types/follow-up";
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const note = (body.note as string | undefined)?.trim();
  if (!note) {
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  }

  const { data: followUp, error } = await supabase
    .from("order_follow_ups")
    .select("id, market_id, status, confirming_agent_id")
    .eq("id", id)
    .single();
  if (error || !followUp) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  if (
    !canAppendEntry(
      role,
      {
        market_id: followUp.market_id,
        confirming_agent_id: followUp.confirming_agent_id,
      },
      actor.id,
      actor.market_id ?? null
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorType: FollowUpActorType =
    role === "super_admin"
      ? "super_admin"
      : role === "market_manager"
        ? "manager"
        : "agent";

  const { data: entry, error: insertErr } = await supabase
    .from("order_follow_up_entries")
    .insert({
      follow_up_id: id,
      status_from: null,
      status_to: null,
      note,
      actor_id: actor.id,
      actor_type: actorType,
    })
    .select("*")
    .single();

  if (insertErr) {
    console.error("[POST /api/follow-ups/[id]/entries]", insertErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: entry }, { status: 201 });
}
