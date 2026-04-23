import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewLeads, canCreateLead } from "@/lib/lead-permissions";
import { LEAD_SOURCES, LEAD_STATUSES, type LeadSource, type LeadStatus } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  if (marketId && !canViewLeads(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10))
  );
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase.from("leads").select("*", { count: "exact" });

  if (marketId) query = query.eq("market_id", marketId);
  if (role === "agent") query = query.eq("assigned_to", actor.id);

  const status = req.nextUrl.searchParams.get("status");
  if (status) query = query.eq("status", status);

  const source = req.nextUrl.searchParams.get("source");
  if (source) query = query.eq("source", source);

  const assignedTo = req.nextUrl.searchParams.get("agent_id");
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const dateFrom = req.nextUrl.searchParams.get("date_from");
  if (dateFrom) query = query.gte("created_at", dateFrom);

  const dateTo = req.nextUrl.searchParams.get("date_to");
  if (dateTo) query = query.lte("created_at", dateTo);

  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  if (campaignId) query = query.eq("campaign_id", campaignId);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}

export async function POST(req: NextRequest) {
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

  if (!LEAD_SOURCES.includes(source as LeadSource)) {
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
