import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import type { MyFeedbackRow } from "@/types/feedback";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

type RawMine = Omit<MyFeedbackRow, "customer_name" | "order_ref"> & {
  customer: { name: string | null } | null;
  order: { id: string; external_id: string | null; customer_name: string | null } | null;
};

/** The most an agent has written so far is ~110 (imported notes included). */
const LIMIT = 1000;

/**
 * GET /api/feedback/mine — « Mes retours »: what the signed-in person wrote, newest first,
 * with the read-only status of their complaints. Imported « Autre » notes are theirs too (the
 * import credits the agent who rejected), so they show here from day one.
 */
async function handleGET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canCaptureFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_feedback")
    .select(
      "id, created_at, category, topic_id, body, moment, status, product:products(id, name, image_url), "
        + "customer:customers(name), order:orders(id, external_id, customer_name)",
    )
    .eq("created_by", actor.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    console.error("[api/feedback/mine]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows: MyFeedbackRow[] = ((data ?? []) as unknown as RawMine[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    category: r.category,
    topic_id: r.topic_id,
    body: r.body,
    moment: r.moment,
    status: r.status,
    product: r.product ? { id: r.product.id, name: r.product.name, image_url: r.product.image_url } : null,
    // Same reading as the manager's sheet (/api/feedback/rows): the order's name first.
    customer_name: r.order?.customer_name ?? r.customer?.name ?? null,
    order_ref: r.order ? r.order.external_id ?? r.order.id.slice(0, 8) : null,
  }));
  return NextResponse.json({ data: rows });
}

export const GET = withRouteErrors("/api/feedback/mine", "GET", handleGET);
