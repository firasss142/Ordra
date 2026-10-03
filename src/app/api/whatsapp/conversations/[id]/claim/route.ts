import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/whatsapp/conversations/[id]/claim { order_id } | { lead_id } —
 * « Rattacher à ». The RPC checks the role, the market, and back-fills the
 * unanchored messages. 409 when the conversation is already anchored: a
 * manager must unlink deliberately, not by accident from a search result.
 */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { order_id?: string; lead_id?: string; force?: boolean };
  const orderId = typeof body.order_id === "string" && body.order_id ? body.order_id : null;
  const leadId = typeof body.lead_id === "string" && body.lead_id ? body.lead_id : null;
  if ((orderId === null) === (leadId === null)) return NextResponse.json({ error: "order_id or lead_id is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin.from("whatsapp_conversations").select("id, current_order_id, current_lead_id").eq("id", params.id).maybeSingle();
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((conv.current_order_id || conv.current_lead_id) && !body.force) {
    return NextResponse.json({ error: "already_anchored", current_order_id: conv.current_order_id, current_lead_id: conv.current_lead_id }, { status: 409 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("whatsapp_claim_conversation", { p_conversation_id: params.id, p_order_id: orderId, p_lead_id: leadId });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "P0002") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (code === "22023") return NextResponse.json({ error: "bad_request" }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: { backfilled: data ?? 0, order_id: orderId, lead_id: leadId } });
}

export const POST = withRouteErrors("/api/whatsapp/conversations/[id]/claim", "POST", handlePOST);
