import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewLeads, canArchiveLead } from "@/lib/lead-permissions";
import { transitionLeadStatus } from "@/lib/leads/transition";
import type { LeadStatus } from "@/types/lead";
import { isTerminalLeadStatus } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const PATCHABLE_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_address",
  "customer_city",
  "product_interest_id",
  "product_interest_note",
  "notes",
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const supabase = await createClient();

    const actorResult = await getActor(req);
    if ("response" in actorResult) return actorResult.response;
    const { actor } = actorResult;
    const role = actor.role;

    const { data: lead, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !lead) {
      console.error("[GET /api/leads/[id]] lookup failed", { id, error });
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!canViewLeads(role, lead.market_id, actor.market_id ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (role === "agent" && lead.assigned_to !== actor.id) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const { data: history, error: historyError } = await supabase
      .from("lead_history")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: true });

    if (historyError) {
      console.error("[GET /api/leads/[id]] history fetch failed", {
        id,
        error: historyError,
      });
    }

    return NextResponse.json({ data: { ...lead, history: history ?? [] } });
  } catch (err) {
    console.error("[GET /api/leads/[id]] exception", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
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

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, status, assigned_to, market_id")
    .eq("id", id)
    .single();
  if (leadError || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (role === "agent" && lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (isTerminalLeadStatus(lead.status as LeadStatus)) {
    return NextResponse.json(
      { error: "Cannot edit terminal lead" },
      { status: 409 }
    );
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

  updates.updated_at = new Date().toISOString();
  const changedFields = Object.keys(updates).filter((k) => k !== "updated_at");
  const note = JSON.stringify(
    changedFields.reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = updates[k];
      return acc;
    }, {})
  );

  const [{ error: updateError }] = await Promise.all([
    supabase.from("leads").update(updates).eq("id", id),
    supabase.from("lead_history").insert({
      lead_id: id,
      status_from: lead.status,
      status_to: lead.status,
      actor_id: actor.id,
      actor_type: role === "agent" ? "agent" : "manager",
      note,
    }),
  ]);

  if (updateError) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { ...lead, ...updates } }, { status: 200 });
}

// DELETE = archive (not hard delete). Managers + super_admin only.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canArchiveLead(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("market_id, status")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (
    role === "market_manager" &&
    lead.market_id !== (actor.market_id ?? "")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (isTerminalLeadStatus(lead.status as LeadStatus)) {
    return NextResponse.json(
      { error: "Lead already terminal" },
      { status: 409 }
    );
  }

  try {
    const result = await transitionLeadStatus(supabase, {
      leadId: id,
      newStatus: "archived",
      actorId: actor.id,
      actorType: "manager",
      note: "Archived",
    });
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
