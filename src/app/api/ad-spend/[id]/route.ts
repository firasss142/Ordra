import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewProfitability } from "@/lib/profitability-permissions";

async function resolveActorAndEntry(req: NextRequest, id: string) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return { err: actorResult.response } as const;
  const { actor } = actorResult;

  if (!canViewProfitability(actor.role)) {
    return { err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  const { data: entry } = await supabase
    .from("ad_spend")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!entry) return { err: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  if (actor.role === "market_manager" && entry.market_id !== actor.market_id) {
    return { err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }

  return { supabase, role: actor.role } as const;
}

// PUT: legacy soft-delete (kept for existing UI compatibility)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resolved = await resolveActorAndEntry(req, id);
  if ("err" in resolved) return resolved.err;
  const { supabase } = resolved;

  const body = await req.json();

  const { data, error } = await supabase
    .from("ad_spend")
    .update({ is_active: body.is_active ?? false })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// PATCH: update entry fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resolved = await resolveActorAndEntry(req, id);
  if ("err" in resolved) return resolved.err;
  const { supabase } = resolved;

  const body = await req.json();
  const { amount, note, period_start, period_end } = body;

  const updates: Record<string, unknown> = {};
  if (amount !== undefined) {
    if (Number(amount) < 0) {
      return NextResponse.json({ error: "amount must be non-negative" }, { status: 400 });
    }
    updates.amount = Number(amount);
  }
  if (note !== undefined) updates.note = note;
  if (period_start !== undefined) updates.period_start = period_start;
  if (period_end !== undefined) updates.period_end = period_end;

  const resolvedStart = updates.period_start ?? undefined;
  const resolvedEnd = updates.period_end ?? undefined;
  if (resolvedStart && resolvedEnd && resolvedStart > resolvedEnd) {
    return NextResponse.json({ error: "period_start must be before period_end" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ad_spend")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// DELETE: soft delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const resolved = await resolveActorAndEntry(req, id);
  if ("err" in resolved) return resolved.err;
  const { supabase } = resolved;

  const { data, error } = await supabase
    .from("ad_spend")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
