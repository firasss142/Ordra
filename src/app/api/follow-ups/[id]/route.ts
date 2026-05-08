import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canViewFollowUp,
  canEditFollowUp,
  canDeleteFollowUp,
} from "@/lib/follow-up-permissions";

export const dynamic = "force-dynamic";

const PATCHABLE_FIELDS = ["delivery_man_phone", "description"] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  // Parallel fetch: follow-up + entries. RLS on entries enforces the same
  // predicate as the follow-up row, so a forbidden caller sees neither.
  const [followUpResult, entriesResult] = await Promise.all([
    supabase
      .from("order_follow_ups")
      .select(
        `
        id, market_id, order_id, status, delivery_man_phone, description,
        confirming_agent_id, resolved_at, created_by, created_at, updated_at,
        order:orders!inner (
          id, customer_name, customer_phone, customer_city, total_price, status, assigned_to
        )
      `,
      )
      .eq("id", id)
      .single(),
    supabase
      .from("order_follow_up_entries")
      .select(
        "id, follow_up_id, status_from, status_to, note, actor_id, actor_type, created_at",
      )
      .eq("follow_up_id", id)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  const { data: followUp, error } = followUpResult;
  if (error || !followUp) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  if (
    !canViewFollowUp(
      role,
      {
        market_id: followUp.market_id,
        confirming_agent_id: followUp.confirming_agent_id,
      },
      actor.id,
      actor.market_id ?? null
    )
  ) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  if (entriesResult.error) {
    console.error("[GET /api/follow-ups/[id]] entries", entriesResult.error);
  }

  return NextResponse.json(
    { data: { ...followUp, entries: entriesResult.data ?? [] } },
    { headers: { "Cache-Control": "private, max-age=2" } },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const { data: followUp, error: loadErr } = await supabase
    .from("order_follow_ups")
    .select("id, market_id, status, confirming_agent_id")
    .eq("id", id)
    .single();
  if (loadErr || !followUp) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  if (
    !canEditFollowUp(
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const field of PATCHABLE_FIELDS) {
    if (field in body && body[field] !== undefined) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No editable fields provided" },
      { status: 400 }
    );
  }

  const changedFields = Object.keys(updates);
  const note = JSON.stringify(
    changedFields.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = updates[k];
      return acc;
    }, {})
  );

  updates.updated_at = new Date().toISOString();

  const actorType =
    role === "super_admin"
      ? "super_admin"
      : role === "market_manager"
        ? "manager"
        : "agent";

  const [{ error: updateError }] = await Promise.all([
    supabase.from("order_follow_ups").update(updates).eq("id", id),
    supabase.from("order_follow_up_entries").insert({
      follow_up_id: id,
      status_from: followUp.status,
      status_to: followUp.status,
      note,
      actor_id: actor.id,
      actor_type: actorType,
    }),
  ]);

  if (updateError) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { id, ...updates } }, { status: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canDeleteFollowUp(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("order_follow_ups").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: { id } }, { status: 200 });
}
