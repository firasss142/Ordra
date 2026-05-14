import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canCreateFollowUp } from "@/lib/follow-up-permissions";
import { createOrderFollowUp } from "@/lib/follow-ups/create";
import { getFollowUpsPage } from "@/lib/follow-ups/list";
import {
  FOLLOW_UP_STATUSES,
  type FollowUpActorType,
  type FollowUpStatus,
} from "@/types/follow-up";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? null;

  const params = req.nextUrl.searchParams;

  const limit = Math.min(
    100,
    Math.max(1, parseInt(params.get("limit") ?? "25", 10) || 25),
  );

  const marketParam = params.get("market_id");
  const marketId =
    role === "super_admin"
      ? marketParam && marketParam !== "all"
        ? marketParam
        : null
      : actorMarketId;

  const statusParam = params.get("status");
  const status =
    statusParam && (FOLLOW_UP_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as FollowUpStatus)
      : undefined;

  const agentParam = params.get("agent_id");
  const agentId =
    role === "agent"
      ? actor.id
      : agentParam && agentParam.length > 0
        ? agentParam
        : null;

  const campaignParam = params.get("campaign_id");
  const campaignId =
    campaignParam && campaignParam.length > 0 ? campaignParam : null;

  const cursor = params.get("cursor");

  const supabase = await createClient();

  try {
    const page = await getFollowUpsPage(supabase, {
      marketId,
      status,
      agentId,
      campaignId,
      cursor,
      limit,
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, max-age=2" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (/invalid cursor/i.test(message)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
    console.error("[GET /api/follow-ups]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.order_id as string | undefined;
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const [orderResult, confirmResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, market_id, status")
      .eq("id", orderId)
      .single(),
    supabase
      .from("order_history")
      .select("actor_id")
      .eq("order_id", orderId)
      .eq("status_to", "confirmed")
      .eq("actor_type", "agent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: order, error: orderErr } = orderResult;
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const confirmingAgentId = (confirmResult.data?.actor_id as string | null) ?? null;

  if (
    !canCreateFollowUp(role, order, confirmingAgentId, actor.id, actorMarketId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorType: FollowUpActorType =
    role === "super_admin" ? "super_admin" : role === "market_manager" ? "manager" : "agent";

  // Optional initial_status override (manager/super_admin only — not agents).
  // Creates at "open" first, then transitions if requested.
  const requestedStatus = body.initial_status as FollowUpStatus | undefined;
  const validOverride =
    role !== "agent" &&
    requestedStatus &&
    FOLLOW_UP_STATUSES.includes(requestedStatus) &&
    requestedStatus !== "open";

  try {
    const result = await createOrderFollowUp(supabase, {
      orderId,
      actorId: actor.id,
      actorType,
      deliveryManPhone: (body.delivery_man_phone as string | undefined) ?? undefined,
      description: (body.description as string | undefined) ?? undefined,
    });

    if (validOverride) {
      await supabase.rpc("rpc_transition_follow_up_status", {
        p_follow_up_id: result.followUpId,
        p_new_status_key: requestedStatus,
        p_actor_id: actor.id,
        p_actor_type: actorType,
        p_note: `Created directly in status: ${requestedStatus}`,
      });
    }

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    if (/unique|already/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (/post-confirmation|not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[POST /api/follow-ups]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
