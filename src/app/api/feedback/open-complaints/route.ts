import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/feedback/open-complaints — `{ phone_normalized: count }` for every customer of the
 * market with a réclamation still open or being handled. The queue row reads it to print
 * « 1 réclamation ouverte » before the agent calls; queue rows carry the phone, not the
 * customer id, and `customers.phone_normalized` is the same key normalizePhone() builds.
 * Complaints are few (tens), so this is one small read for the whole queue.
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canCaptureFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const market = resolveFeedbackMarket(actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in market) return market.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_feedback")
    .select("id, customer_id, customer:customers(phone_normalized)")
    .eq("market_id", market.marketId)
    .eq("category", "reclamation")
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .not("customer_id", "is", null);
  if (error) {
    console.error("[api/feedback/open-complaints]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const byPhone: Record<string, number> = {};
  for (const r of (data ?? []) as unknown as { customer: { phone_normalized: string | null } | null }[]) {
    const phone = r.customer?.phone_normalized;
    if (phone) byPhone[phone] = (byPhone[phone] ?? 0) + 1;
  }
  return NextResponse.json({ data: byPhone });
}
