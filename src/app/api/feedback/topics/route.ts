import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/taxonomy";
import type { FeedbackTopic } from "@/types/feedback";

export const dynamic = "force-dynamic";

/** GET /api/feedback/topics — the market's active topics, by category then their order. */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canCaptureFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const market = resolveFeedbackMarket(result.actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in market) return market.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback_topics")
    .select("id, category, key, label_fr, label_ar, sort_order")
    .eq("market_id", market.marketId)
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Réclamation → objection → suggestion, the order of the three cards — sorted here rather
  // than by the enum, so the order never depends on how a client sorts the column.
  const rank = (c: string) => FEEDBACK_CATEGORIES.indexOf(c as FeedbackTopic["category"]);
  const rows: FeedbackTopic[] = ((data ?? []) as FeedbackTopic[])
    .map((t) => ({
      id: t.id, category: t.category, key: t.key, label_fr: t.label_fr, label_ar: t.label_ar, sort_order: t.sort_order,
    }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.sort_order - b.sort_order);
  return NextResponse.json({ data: rows });
}
