import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { isUuid, rpcErrorResponse } from "@/lib/feedback/api";

export const dynamic = "force-dynamic";

const MAX_IDS = 500;

/**
 * POST /api/feedback/review { action: "keep" | "ignore", ids } — the « À valider » queue:
 * courier remarks and imported « Autre » notes waiting for a manager. Keeping a réclamation
 * opens it; ignoring soft-deletes it. Both RPCs only touch rows still awaiting review in the
 * caller's market, and answer how many they moved.
 */
export async function POST(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canManageFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { action?: unknown; ids?: unknown };
  try {
    body = (await req.json()) as { action?: unknown; ids?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (body.action !== "keep" && body.action !== "ignore") return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid)) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(body.action === "keep" ? "keep_customer_feedback" : "ignore_customer_feedback", {
    p_ids: ids,
  });
  if (error) return rpcErrorResponse(error, body.action);
  return NextResponse.json({ data: { count: Number(data ?? 0) } });
}
