import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { CampaignFilterJson } from "@/types/follow-up";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? null
      : actor.market_id;

  let query = supabase
    .from("follow_up_campaigns")
    .select("id, market_id, name, filter_json, created_by, created_at")
    .order("created_at", { ascending: false });

  if (marketId) query = query.eq("market_id", marketId);

  const { data, error } = await query;
  if (error) {
    console.error("[GET /api/follow-up-campaigns]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name as string | undefined;
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const filterJson = (body.filter_json ?? {}) as CampaignFilterJson;
  const marketId =
    role === "super_admin"
      ? (body.market_id as string | undefined) ?? actor.market_id
      : actor.market_id;

  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  // Create campaign row
  const { data: campaign, error: insertErr } = await supabase
    .from("follow_up_campaigns")
    .insert({ market_id: marketId, name: name.trim(), filter_json: filterJson, created_by: actor.id })
    .select("id, market_id, name")
    .single();

  if (insertErr || !campaign) {
    if (insertErr?.code === "23505") {
      return NextResponse.json({ error: "A campaign with this name already exists" }, { status: 409 });
    }
    console.error("[POST /api/follow-up-campaigns] insert", insertErr);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  // Bulk-create follow-ups via RPC
  const actorType = role === "super_admin" ? "super_admin" : "manager";
  const { data: rpcResult, error: rpcErr } = await supabase.rpc(
    "bulk_create_campaign_follow_ups",
    {
      p_campaign_id: campaign.id,
      p_actor_id: actor.id,
      p_actor_type: actorType,
    }
  );

  if (rpcErr) {
    console.error("[POST /api/follow-up-campaigns] rpc", rpcErr);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const createdCount = (rpcResult as { created_count: number })?.created_count ?? 0;
  const skippedCount = (rpcResult as { skipped_count: number })?.skipped_count ?? 0;

  // Round-robin assignment: distribute follow-ups across active agents.
  // Uses admin client to bypass RLS — this is a server-side manager action.
  const assignMode = body.assign_mode as string | undefined;
  if (assignMode === "round_robin" && createdCount > 0) {
    const admin = createAdminClient();

    const [followUpsResult, agentsResult] = await Promise.all([
      admin
        .from("order_follow_ups")
        .select("id")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: true }),
      admin
        .from("users")
        .select("id")
        .eq("market_id", marketId)
        .eq("role", "agent")
        .eq("is_active", true),
    ]);

    if (followUpsResult.error) {
      console.error("[POST /api/follow-up-campaigns] fetch follow-ups for rr", followUpsResult.error);
    }
    if (agentsResult.error) {
      console.error("[POST /api/follow-up-campaigns] fetch agents for rr", agentsResult.error);
    }

    const followUpIds = (followUpsResult.data ?? []).map((r: { id: string }) => r.id);
    const agents = (agentsResult.data ?? []) as Array<{ id: string }>;

    if (agents.length > 0 && followUpIds.length > 0) {
      // Count each agent's current active queue to sort least-loaded first
      const { data: queueRows, error: queueErr } = await admin
        .from("order_follow_ups")
        .select("confirming_agent_id")
        .in("confirming_agent_id", agents.map((a) => a.id))
        .in("status", ["open", "in_progress", "escalated"]);

      if (queueErr) console.error("[POST /api/follow-up-campaigns] queue count", queueErr);

      const queueSizeByAgent: Record<string, number> = {};
      for (const a of agents) queueSizeByAgent[a.id] = 0;
      for (const row of (queueRows ?? [])) {
        if (row.confirming_agent_id) {
          queueSizeByAgent[row.confirming_agent_id] = (queueSizeByAgent[row.confirming_agent_id] ?? 0) + 1;
        }
      }

      const sortedAgents = [...agents].sort(
        (a, b) => (queueSizeByAgent[a.id] ?? 0) - (queueSizeByAgent[b.id] ?? 0)
      );

      // Build batches: agent_id → [follow_up_ids]
      const batches: Record<string, string[]> = {};
      followUpIds.forEach((fid, idx) => {
        const agentId = sortedAgents[idx % sortedAgents.length].id;
        if (!batches[agentId]) batches[agentId] = [];
        batches[agentId].push(fid);
      });

      // Bulk update each agent's batch, log any errors
      const updateResults = await Promise.all(
        Object.entries(batches).map(([agentId, ids]) =>
          admin
            .from("order_follow_ups")
            .update({ confirming_agent_id: agentId })
            .in("id", ids)
        )
      );
      for (const r of updateResults) {
        if (r.error) console.error("[POST /api/follow-up-campaigns] rr update", r.error);
      }
    } else {
      console.warn("[POST /api/follow-up-campaigns] rr skipped: agents=%d follow-ups=%d", agents.length, followUpIds.length);
    }
  }

  return NextResponse.json(
    {
      data: {
        campaign_id: campaign.id,
        created_count: createdCount,
        skipped_count: skippedCount,
      },
    },
    { status: 201 }
  );
}
