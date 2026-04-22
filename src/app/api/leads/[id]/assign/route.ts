import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignLeads } from "@/lib/lead-permissions";
import { assignLead, unassignLead } from "@/lib/leads/assignment";
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
  const actorMarketId = actor.market_id ?? "";

  let body: { agent_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("market_id")
    .eq("id", id)
    .single();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (!canAssignLeads(role, lead.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (body.agent_id === null) {
      const result = await unassignLead(supabase, id, actor.id);
      return NextResponse.json({ data: result });
    }
    if (!body.agent_id) {
      return NextResponse.json(
        { error: "agent_id is required" },
        { status: 400 }
      );
    }
    const result = await assignLead(supabase, id, body.agent_id, actor.id);
    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    let status = 400;
    if (/not found/i.test(msg)) status = 404;
    else if (/terminal lead|market does not match|inactive/i.test(msg)) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
