import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { FEEDBACK_BODY_MAX, isFeedbackCategory } from "@/lib/feedback/taxonomy";
import { isUuid, rpcErrorResponse } from "@/lib/feedback/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const optionalUuid = (v: unknown): string | null | false =>
  v === undefined || v === null || v === "" ? null : isUuid(v) ? v : false;

/**
 * POST /api/feedback — what the customer said, from the capture window (the F key).
 *
 * Through create_customer_feedback, whose actor is auth.uid(): the market comes from the
 * order (else the customer, else the agent), the customer and product from the order, and
 * the MOMENT from the order's status at this instant. A `moment` in the body is ignored —
 * the client never decides it.
 */
async function handlePOST(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canCaptureFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!isFeedbackCategory(raw.category)) return NextResponse.json({ error: "invalid_category" }, { status: 400 });
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  if (body.length < 1 || body.length > FEEDBACK_BODY_MAX) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const topic = optionalUuid(raw.topic_id);
  const order = optionalUuid(raw.order_id);
  const customer = optionalUuid(raw.customer_id);
  const product = optionalUuid(raw.product_id);
  const market = optionalUuid(raw.market_id);
  if (topic === false || order === false || customer === false || product === false || market === false) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_customer_feedback", {
    p_category: raw.category,
    p_body: body,
    p_topic_id: topic,
    p_order_id: order,
    p_customer_id: customer,
    p_product_id: product,
    p_source: "agent",
    // Only a super_admin's market is taken from the request; the RPC ignores it for anyone else.
    p_market_id: actor.role === "super_admin" ? market : null,
  });
  if (error) return rpcErrorResponse(error, "create");

  // What the server decided — the toast shows the moment it actually recorded.
  const { data: row } = await supabase
    .from("customer_feedback")
    .select("id, moment, category, status")
    .eq("id", id as string)
    .maybeSingle();

  return NextResponse.json({ data: row ?? { id } }, { status: 201 });
}

export const POST = withRouteErrors("/api/feedback", "POST", handlePOST);
