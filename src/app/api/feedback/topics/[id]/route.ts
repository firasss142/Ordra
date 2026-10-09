import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { isUuid, rpcErrorResponse } from "@/lib/feedback/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** CHECK feedback_topics_response_length. */
const RESPONSE_MAX = 500;

/**
 * PATCH /api/feedback/topics/[id] { response } — « Notre réponse » under a reason: what the
 * team does when a customer gives it. An empty text clears it. Managers of the reason's market.
 */
async function handlePATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canManageFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let body: { response?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.response !== "string") return NextResponse.json({ error: "invalid_response" }, { status: 400 });
  const text = body.response.trim();
  if (text.length > RESPONSE_MAX) return NextResponse.json({ error: "invalid_response" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_feedback_topic_response", { p_topic_id: params.id, p_response: text || null });
  if (error) return rpcErrorResponse(error, "topic response");
  return NextResponse.json({ data: { id: params.id, response: text || null } });
}

export const PATCH = withRouteErrors("/api/feedback/topics/[id]", "PATCH", handlePATCH);
