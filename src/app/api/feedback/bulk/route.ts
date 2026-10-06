import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { isUuid, rpcErrorResponse } from "@/lib/feedback/api";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const MAX_IDS = 500;

const RPC = {
  discard: "discard_customer_feedback",
  restore: "restore_customer_feedback",
  topic: "set_customer_feedback_topic",
} as const;
type Action = keyof typeof RPC;

/**
 * POST /api/feedback/bulk — the sheet's gestures, on one row or many (prototype v2):
 *   { action: "discard", ids }            « Écarter » — they stop counting;
 *   { action: "restore", ids }            « Annuler » — only what was discarded comes back;
 *   { action: "topic", ids, topic_id }    « Changer la raison » (null = « Sans raison »).
 * Every RPC only touches the caller's market and answers how many rows it moved.
 */
async function handlePOST(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canManageFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { action?: unknown; ids?: unknown; topic_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const action = body.action as Action;
  if (!(typeof action === "string" && action in RPC)) return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid)) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }
  if (action === "topic" && !(body.topic_id === null || isUuid(body.topic_id))) {
    return NextResponse.json({ error: "invalid_topic" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    RPC[action],
    action === "topic" ? { p_ids: ids, p_topic_id: body.topic_id } : { p_ids: ids },
  );
  if (error) return rpcErrorResponse(error, action);
  return NextResponse.json({ data: { count: Number(data ?? 0) } });
}

export const POST = withRouteErrors("/api/feedback/bulk", "POST", handlePOST);
