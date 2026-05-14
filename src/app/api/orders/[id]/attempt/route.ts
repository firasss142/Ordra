import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { RejectionReason } from "@/types/order-status";
import { getActor } from "@/lib/auth/actor";
import {
  getNextAttemptStatus,
  extractAttemptNumber,
  isMaxAttemptsReached,
} from "@/lib/attempt-logic";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";

export const dynamic = "force-dynamic";

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

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { callback_time?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_to, market_id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Read max_call_attempts from settings first (needed for boundary check)
  const maxAttempts = Number(
    await getMarketSetting(supabase, order.market_id, "max_call_attempts", "3")
  );

  // If current status is already at max attempts, auto-reject (no further attempt possible)
  if (isMaxAttemptsReached(order.status, maxAttempts)) {
    const currentAttemptNumber = extractAttemptNumber(order.status);
    const { error: rejectError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "rejected",
      p_actor_id: actor.id,
      p_actor_type: "system",
      p_note: `Auto-rejected: max attempts reached (tentative ${currentAttemptNumber})`,
      p_rejection_reason: "injoignable" as RejectionReason,
      p_rejection_note: null,
    });

    if (rejectError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({
      data: { auto_rejected: true, new_status: "rejected" },
    });
  }

  const nextStatus = getNextAttemptStatus(order.status);
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Cannot log no-response from status '${order.status}'` },
      { status: 400 }
    );
  }

  const nextAttemptNumber = extractAttemptNumber(nextStatus);

  // If advancing would hit max, auto-reject
  if (isMaxAttemptsReached(nextStatus, maxAttempts)) {
    const { error: rejectError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "rejected",
      p_actor_id: actor.id,
      p_actor_type: "system",
      p_note: `Auto-rejected: max attempts reached (tentative ${nextAttemptNumber})`,
      p_rejection_reason: "injoignable" as RejectionReason,
      p_rejection_note: null,
    });

    if (rejectError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({
      data: { auto_rejected: true, new_status: "rejected" },
    });
  }

  // Not at max: check if callback_time provided → transition to callback_scheduled via RPC
  if (body.callback_time) {
    const { error: cbError } = await supabase.rpc("transition_order_status", {
      p_order_id: id,
      p_new_status: "callback_scheduled",
      p_actor_id: actor.id,
      p_actor_type: "agent",
      p_note: `Pas de réponse — rappel prévu pour ${body.callback_time}`,
      p_rejection_reason: null,
      p_rejection_note: null,
      p_callback_at: body.callback_time,
    });

    if (cbError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({
      data: { auto_rejected: false, new_status: "callback_scheduled" },
    });
  }

  // No callback: advance to next attempt status
  const { error: attemptError } = await supabase.rpc("transition_order_status", {
    p_order_id: id,
    p_new_status: nextStatus,
    p_actor_id: actor.id,
    p_actor_type: "agent",
    p_note: `Pas de réponse — tentative ${nextAttemptNumber}`,
    p_rejection_reason: null,
    p_rejection_note: null,
  });

  if (attemptError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: { auto_rejected: false, new_status: nextStatus },
  });
}
