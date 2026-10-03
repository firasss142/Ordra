import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import type { MyFeedbackRow } from "@/types/feedback";

export const dynamic = "force-dynamic";

/** The most an agent has written so far is ~110 (imported notes included). */
const LIMIT = 1000;

/**
 * GET /api/feedback/mine — « Mes retours »: what the signed-in person wrote, newest first,
 * with the read-only status of their complaints. Imported « Autre » notes are theirs too (the
 * import credits the agent who rejected), so they show here from day one.
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canCaptureFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_feedback")
    .select("id, created_at, category, topic_id, body, moment, status, product:products(id, name, image_url)")
    .eq("created_by", actor.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    console.error("[api/feedback/mine]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows: MyFeedbackRow[] = ((data ?? []) as unknown as MyFeedbackRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    category: r.category,
    topic_id: r.topic_id,
    body: r.body,
    moment: r.moment,
    status: r.status,
    product: r.product ? { id: r.product.id, name: r.product.name, image_url: r.product.image_url } : null,
  }));
  return NextResponse.json({ data: rows });
}
