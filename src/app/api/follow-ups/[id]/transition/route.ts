import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canTransitionFollowUp } from "@/lib/follow-up-permissions";
import { transitionFollowUpStatus } from "@/lib/follow-ups/transition";
import { getActor } from "@/lib/auth/actor";
import {
  FOLLOW_UP_STATUSES,
  type FollowUpStatus,
  type FollowUpActorType,
} from "@/types/follow-up";

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

  const newStatus = body.new_status as FollowUpStatus | undefined;
  if (!newStatus || !FOLLOW_UP_STATUSES.includes(newStatus)) {
    return NextResponse.json({ error: "Invalid new_status" }, { status: 400 });
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
    !canTransitionFollowUp(
      role,
      {
        market_id: followUp.market_id,
        confirming_agent_id: followUp.confirming_agent_id,
      },
      followUp.status as FollowUpStatus,
      newStatus,
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

  try {
    const result = await transitionFollowUpStatus(supabase, {
      followUpId: id,
      newStatus,
      actorId: actor.id,
      actorType,
      note: (body.note as string | undefined) ?? undefined,
    });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (/invalid .* transition|already in status/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[POST /api/follow-ups/[id]/transition]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
