import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { activePreset, presetRange, prevRange } from "@/lib/feedback/date-range";
import { computeOverview, COURIER_AGENT, type CubeRow } from "@/lib/feedback/overview";
import { loadFamilies, readRange } from "@/lib/feedback/server-data";
import { isFeedbackCategory, isLateComplaint, type FeedbackCategory } from "@/lib/feedback/taxonomy";
import { marketTimezone } from "@/lib/markets";
import { todayInMarket } from "@/lib/dates/market-day";
import type { FeedbackOverviewResponse, FeedbackTopic } from "@/types/feedback";

export const dynamic = "force-dynamic";

/**
 * GET /api/feedback/overview?from&to&family&agent&cat — every number above the manager's
 * sheet (prototype voix-du-client-manager-v6): the product tabs, the three category cards
 * with their trend against the previous period of the same length, the category mix, the
 * top topics, the entries per agent, the open/late complaints and the « à valider » count.
 *
 * The counting is SQL (feedback_cube, under RLS); the arithmetic is computeOverview, which is
 * tested against the prototype's rules. Dates are market days (Africa/Tripoli for Libya).
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  const { actor } = result;
  if (!canManageFeedback(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const market = resolveFeedbackMarket(actor, req.nextUrl.searchParams.get("market_id"));
  if ("response" in market) return market.response;
  const marketId = market.marketId;
  const params = req.nextUrl.searchParams;

  const today = todayInMarket(marketId);
  const tz = marketTimezone(marketId);
  const supabase = await createClient();

  const { data: firstRow } = await supabase
    .from("customer_feedback")
    .select("created_at")
    .eq("market_id", marketId)
    .eq("needs_review", false)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const first = firstRow ? todayInMarket(marketId, new Date((firstRow as { created_at: string }).created_at)) : null;

  const range = readRange(params, presetRange("d30", today, first));
  if (!range) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const [from, to] = range;
  const hasPrev = first !== null && from > first;

  const familyParam = params.get("family");
  const agentParam = params.get("agent");
  const catParam = params.get("cat");
  const category: FeedbackCategory | null = isFeedbackCategory(catParam) ? catParam : null;

  const [{ families, products }, cubeRes, topicsRes, agentsRes] = await Promise.all([
    loadFamilies(supabase, marketId),
    supabase.rpc("feedback_cube", { p_market_id: marketId, p_from: prevRange(from, to)[0], p_to: to, p_tz: tz }),
    supabase.from("feedback_topics").select("id, category, key, label_fr, label_ar, sort_order").eq("market_id", marketId),
    supabase
      .from("users")
      .select("id, full_name")
      .eq("market_id", marketId)
      .eq("role", "agent")
      .eq("is_active", true)
      .is("deleted_at", null),
  ]);
  if (cubeRes.error) {
    console.error("[api/feedback/overview] cube", cubeRes.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const cube = (cubeRes.data ?? []) as CubeRow[];
  const agents = ((agentsRes.data ?? []) as { id: string; full_name: string | null }[]).map((u) => ({
    id: u.id,
    name: (u.full_name ?? "").trim() || u.id.slice(0, 6),
  }));
  const family = families.find((f) => f.id === familyParam) ?? null;

  const o = computeOverview({
    cube, from, to, hasPrev, families, agents,
    familyId: family?.id ?? null,
    agentId: agentParam === COURIER_AGENT || (agentParam && agents.some((a) => a.id === agentParam)) ? agentParam : null,
    category,
  });

  // A family earns a tab while it is sold, or while it has something to show.
  const counted = new Map(o.tabs.byFamily.map((t) => [t.id, t.count]));
  const activeIds = new Set(products.filter((p) => p.is_active).map((p) => p.id));
  const shownFamilies = families.filter((f) => (counted.get(f.id) ?? 0) > 0 || f.productIds.some((id) => activeIds.has(id)));
  const shownIds = new Set(shownFamilies.map((f) => f.id));

  // Waiting work is not bound to the period: an open complaint from August is still open.
  let complaintsQ = supabase
    .from("customer_feedback")
    .select("id, category, status, created_at")
    .eq("market_id", marketId)
    .eq("category", "reclamation")
    .eq("needs_review", false)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null);
  let reviewQ = supabase
    .from("customer_feedback")
    .select("id", { count: "exact", head: true })
    .eq("market_id", marketId)
    .eq("needs_review", true)
    .is("deleted_at", null);
  if (family) {
    complaintsQ = complaintsQ.in("product_id", family.productIds);
    reviewQ = reviewQ.in("product_id", family.productIds);
  }
  const [complaintsRes, reviewRes] = await Promise.all([complaintsQ, reviewQ]);
  const open = (complaintsRes.data ?? []) as { category: FeedbackCategory; status: string | null; created_at: string }[];
  const now = Date.now();

  const body: FeedbackOverviewResponse = {
    today,
    first,
    from,
    to,
    preset: activePreset(from, to, today, first),
    hasPrev,
    families: shownFamilies,
    topics: (topicsRes.data ?? []) as FeedbackTopic[],
    agents,
    tabs: { all: o.tabs.all, byFamily: o.tabs.byFamily.filter((t) => shownIds.has(t.id)) },
    kpis: o.kpis,
    total: o.total,
    mix: o.mix,
    ranked: o.topics,
    byAgent: o.agents,
    agentsTotal: o.agentsTotal,
    complaints: { open: open.length, late: open.filter((c) => isLateComplaint(c, now)).length },
    review: reviewRes.count ?? 0,
  };
  return NextResponse.json({ data: body });
}
