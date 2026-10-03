import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTransition } from "@/lib/order-engine";
import type { OrderStatus, RejectionReason } from "@/types/order-status";
import { isValidPair, REJECTION_GROUPS } from "@/lib/orders/rejection-taxonomy";
import {
  buildRejectionTree,
  validateRejectionPair,
} from "@/lib/orders/rejection-config";
import { getActor } from "@/lib/auth/actor";
import {
  actorTypeFor,
  loadTakeOverContext,
  logManagerTakeOver,
  type ManagerActor,
} from "@/lib/orders/manager-takeover";
import { lockedResponse } from "@/lib/orders/order-lock-response";
import { isFeedbackCategory } from "@/lib/feedback/taxonomy";
import { isUuid } from "@/lib/feedback/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent" && role !== "market_manager" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    rejection_reason: string;
    rejection_subreason?: string | null;
    rejection_note?: string;
    /** Voix du client: keep the « Autre » note as the customer's words. */
    feedback?: { category?: unknown; topic_id?: unknown } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The taxonomy is per-market data now, so validation reads it rather than a
  // compiled-in list: a sub-reason a manager adds this morning has to work this
  // afternoon, and one they retire has to stop working immediately.
  //
  // The market comes from the ORDER, not from the actor — a super_admin rejects
  // orders in markets they do not belong to.
  const { data: orderMarket } = await supabase
    .from("orders")
    .select("market_id")
    .eq("id", id)
    .single();

  if (!orderMarket) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: configRows } = await supabase
    .from("rejection_reason_configs")
    .select("*")
    .eq("market_id", orderMarket.market_id);

  // `activeOnly`: validation is about what may be chosen now. History keeps
  // rendering retired reasons, but nothing new may be written with one.
  const tree = buildRejectionTree(configRows ?? [], { activeOnly: true });

  const group = body.rejection_reason ?? "";
  const sub = body.rejection_subreason ?? null;

  // An empty table means the migration has not run yet — the code can deploy
  // ahead of it. Falling back to the compiled taxonomy keeps rejections working
  // through that window instead of refusing every one of them.
  const valid =
    tree.length > 0
      ? validateRejectionPair(tree, group, sub)
      : isValidPair(group, sub);

  if (!valid) {
    const offered =
      tree.length > 0
        ? tree.map((g) => g.key).join(", ")
        : REJECTION_GROUPS.join(", ");
    return NextResponse.json(
      {
        error:
          `Invalid rejection reason. Group must be one of: ${offered}` +
          ", with an active sub-reason belonging to it.",
      },
      { status: 400 }
    );
  }

  // Which groups demand a free-text note is configuration too, not the literal
  // string "autre" — a market may well name its escape hatch something else.
  const needsNote =
    tree.find((g) => g.key === group)?.requiresNote ?? group === "autre";

  if (needsNote && !body.rejection_note?.trim()) {
    return NextResponse.json(
      { error: `rejection_note is required when rejection_reason is '${group}'` },
      { status: 400 }
    );
  }

  // « Aussi un retour client » (Voix du client, agent prototype v2 screen ④): only on a
  // note-only group, where the note IS what the customer said. Written after the rejection
  // and never allowed to undo it — a failed entry costs the insight, not the order.
  const feedbackOffer =
    needsNote && body.feedback && isFeedbackCategory(body.feedback.category) ? body.feedback : null;
  async function recordFeedback(): Promise<string | null> {
    if (!feedbackOffer) return null;
    const { data, error } = await supabase.rpc("create_customer_feedback", {
      p_category: feedbackOffer.category,
      p_body: (body.rejection_note ?? "").trim(),
      p_topic_id: isUuid(feedbackOffer.topic_id) ? feedbackOffer.topic_id : null,
      p_order_id: id,
      p_source: "rejection",
    });
    if (error) {
      console.error("[api/orders/reject] feedback not recorded", error);
      return null;
    }
    return (data as string | null) ?? null;
  }
  const done = async () => {
    const feedbackId = await recordFeedback();
    return NextResponse.json({
      data: feedbackOffer ? { new_status: "rejected", feedback_id: feedbackId } : { new_status: "rejected" },
    });
  };

  const isManager = role !== "agent";

  if (isManager) {
    const ctx = await loadTakeOverContext(
      supabase,
      id,
      actor as ManagerActor,
    );
    if ("error" in ctx) {
      const status =
        ctx.error === "not_found" ? 404 : ctx.error === "forbidden" ? 403 : 400;
      const message =
        ctx.error === "terminal"
          ? "Order is in a terminal status"
          : ctx.error === "forbidden"
          ? "Forbidden"
          : "Order not found";
      return NextResponse.json({ error: message }, { status });
    }

    const { data: orderRow } = await supabase
      .from("orders")
      .select("status")
      .eq("id", id)
      .single();

    if (!orderRow) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const validation = validateTransition(orderRow.status as OrderStatus, "rejected");
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    await logManagerTakeOver(supabase, {
      orderId: id,
      orderStatus: orderRow.status,
      actor: actor as ManagerActor,
      originalAgentId: ctx.originalAgentId,
      originalAgentName: ctx.originalAgentName,
    });

    const { error: rejectError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "rejected",
      p_actor_id: actor.id,
      p_actor_type: actorTypeFor(role),
      p_note: body.rejection_note ?? null,
      p_rejection_reason: body.rejection_reason as RejectionReason,
      p_rejection_subreason: body.rejection_subreason ?? null,
      p_rejection_note: body.rejection_note ?? null,
    });

    if (rejectError) {
      // 55006 = the agent-presence guard. A refusal, not a fault:
      // answer 409 { code: "locked" } naming the agent who holds it.
      const lockedRes = lockedResponse(rejectError);
      if (lockedRes) return lockedRes;
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return done();
  }

  // Agent path (unchanged)
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const validation = validateTransition(order.status as OrderStatus, "rejected");
  if (!validation.valid) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  const { error: rejectError } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: "rejected",
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: body.rejection_note ?? null,
    p_rejection_reason: body.rejection_reason as RejectionReason,
    p_rejection_subreason: body.rejection_subreason ?? null,
    p_rejection_note: body.rejection_note ?? null,
  });

  if (rejectError) {
    // 55006 = the agent-presence guard. A refusal, not a fault:
    // answer 409 { code: "locked" } naming the agent who holds it.
    const lockedRes = lockedResponse(rejectError);
    if (lockedRes) return lockedRes;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return done();
}

export const POST = withRouteErrors("/api/orders/[id]/reject", "POST", handlePOST);
