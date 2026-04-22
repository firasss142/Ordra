import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

interface PatchBody {
  label_fr?: string;
  label_ar?: string;
  color?: string;
  sort_order?: number;
  is_initial?: boolean;
  is_terminal?: boolean;
  allowed_transitions?: string[];
  // Present to detect & reject caller attempts to rename the key
  key?: string;
  market_id?: string;
  scope?: string;
}

const MUTABLE_FIELDS = new Set([
  "label_fr",
  "label_ar",
  "color",
  "sort_order",
  "is_initial",
  "is_terminal",
  "allowed_transitions",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.key !== undefined) {
    return NextResponse.json(
      { error: "key is immutable once a status exists" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (MUTABLE_FIELDS.has(k) && v !== undefined) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 }
    );
  }

  if (updates.allowed_transitions !== undefined) {
    const arr = updates.allowed_transitions;
    if (
      !Array.isArray(arr) ||
      !arr.every((k) => typeof k === "string")
    ) {
      return NextResponse.json(
        { error: "allowed_transitions must be an array of strings" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("status_configs")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Status not found" }, { status: 404 });
  }

  if (
    actor.role === "market_manager" &&
    existing.market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("status_configs")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("status_configs")
    .select("id, market_id, scope, key, is_initial")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Status not found" }, { status: 404 });
  }

  if (
    actor.role === "market_manager" &&
    existing.market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existing.is_initial) {
    return NextResponse.json(
      { error: "Cannot delete the initial status for a scope" },
      { status: 409 }
    );
  }

  const usageTable = existing.scope === "prospect" ? "leads" : "order_follow_ups";
  const { count, error: countError } = await supabase
    .from(usageTable)
    .select("id", { count: "exact", head: true })
    .eq("market_id", existing.market_id)
    .eq("status_key", existing.key)
    .limit(1);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Status "${existing.key}" is in use by ${count} ${usageTable} row(s) and cannot be deleted`,
      },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("status_configs")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data: { id } });
}
