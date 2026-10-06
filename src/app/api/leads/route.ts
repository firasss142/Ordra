import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canCreateLead } from "@/lib/lead-permissions";
import { CREATABLE_LEAD_SOURCES, LEAD_STATUSES, type LeadSource, type LeadStatus, type CreatableLeadSource } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/*
 * No GET since 2026-10-06. Its only caller was the old CRM kanban (useLeads,
 * deleted), and it filtered on `leads.is_hot` / `has_duplicate`, which do not
 * exist — every such request was a 500. The desk lists through
 * /api/prospects/desk/list; agents through /api/prospects/worklist.
 */

async function handlePOST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketId =
    role === "super_admin"
      ? ((body.market_id as string) ?? "")
      : actorMarketId;

  if (!canCreateLead(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { customer_name, customer_phone, source } = body;

  if (!customer_name || !customer_phone || !source) {
    return NextResponse.json(
      { error: "customer_name, customer_phone, source are required" },
      { status: 400 }
    );
  }

  if (!CREATABLE_LEAD_SOURCES.includes(source as CreatableLeadSource)) {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }

  // Hybrid assignment rule:
  //   role=agent         → self-assign, status=assigned (ignores override)
  //   role=manager|SA    → may override via initial_status body param
  const isAgent = role === "agent";
  const overrideStatus = body.initial_status as LeadStatus | undefined;
  const allowedOverride =
    !isAgent &&
    overrideStatus &&
    LEAD_STATUSES.includes(overrideStatus) &&
    !["won", "lost", "archived"].includes(overrideStatus);
  const initialStatus: LeadStatus = isAgent
    ? "assigned"
    : allowedOverride
    ? overrideStatus
    : "new";
  const assignedTo = isAgent ? actor.id : null;

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      market_id: marketId,
      source,
      source_external_id: body.source_external_id ?? null,
      source_platform: body.source_platform ?? null,
      status: initialStatus,
      customer_name,
      customer_phone,
      customer_city: body.customer_city ?? null,
      customer_address: body.customer_address ?? null,
      product_interest_id: body.product_interest_id ?? null,
      product_interest_note: body.product_interest_note ?? null,
      notes: body.notes ?? null,
      assigned_to: assignedTo,
      callback_scheduled_at: body.callback_scheduled_at ?? null,
      raw_payload: body.raw_payload ?? null,
    })
    .select("id, status, assigned_to, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  await supabase.from("lead_history").insert({
    lead_id: lead.id,
    status_from: null,
    status_to: initialStatus,
    actor_id: actor.id,
    actor_type: isAgent ? "agent" : "manager",
    note: isAgent ? "Lead created by agent (self-assigned)" : "Lead created manually",
  });

  return NextResponse.json({ data: lead }, { status: 201 });
}

export const POST = withRouteErrors("/api/leads", "POST", handlePOST);
