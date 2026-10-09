import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { activePreset, presetRange, prevRange } from "@/lib/feedback/date-range";
import { computeVoice, pickQuotes, COURIER_AGENT, type CubeRow, type QuoteRow, type VoiceReason } from "@/lib/feedback/voice";
import { loadFamilies, readRange } from "@/lib/feedback/server-data";
import { marketTimezone } from "@/lib/markets";
import { marketDayEndUtc, marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import type { FeedbackOverviewResponse, FeedbackReason, FeedbackTopic } from "@/types/feedback";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** « Ce que disent les clients » under an open reason. */
const QUOTES_PER_REASON = 3;

/**
 * GET /api/feedback/overview?from&to&family&agent — every number of « Voix du client »
 * (prototype voix-du-client-et-messages-v2): the sentence and the to-do line, the ranked
 * reasons with their trend, products, « Notre réponse » and three quotes, and the sheet's four
 * minis. Nothing waits for a validation any more: everything not discarded counts.
 *
 * The counting is SQL (feedback_cube, under RLS); the arithmetic is computeVoice. Dates are
 * market days (Africa/Tripoli for Libya).
 */
async function handleGET(req: NextRequest) {
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
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const first = firstRow ? todayInMarket(marketId, new Date((firstRow as { created_at: string }).created_at)) : null;

  const range = readRange(params, presetRange("d30", today, first));
  if (!range) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const [from, to] = range;
  const hasPrev = first !== null && from > first;

  const [{ families, products }, cubeRes, topicsRes, agentsRes] = await Promise.all([
    loadFamilies(supabase, marketId),
    supabase.rpc("feedback_cube", { p_market_id: marketId, p_from: prevRange(from, to)[0], p_to: to, p_tz: tz }),
    supabase
      .from("feedback_topics")
      .select("id, category, key, label_fr, label_ar, sort_order, response")
      .eq("market_id", marketId)
      .order("sort_order", { ascending: true }),
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

  const topics = (topicsRes.data ?? []) as FeedbackTopic[];
  const agents = ((agentsRes.data ?? []) as { id: string; full_name: string | null }[]).map((u) => ({
    id: u.id,
    name: (u.full_name ?? "").trim() || u.id.slice(0, 6),
  }));
  const family = families.find((f) => f.id === params.get("family")) ?? null;
  const agentParam = params.get("agent");
  const agentId = agentParam === COURIER_AGENT || (agentParam && agents.some((a) => a.id === agentParam)) ? agentParam : null;

  const v = computeVoice({
    cube: (cubeRes.data ?? []) as CubeRow[],
    topics, from, to, hasPrev, families,
    familyId: family?.id ?? null,
    agentId,
  });

  // The quotes: what customers said with a reason, in the period, under the same filters.
  let quotesQ = supabase
    .from("customer_feedback")
    .select("id, topic_id, created_at, body, moment, source, author:users!customer_feedback_created_by_fkey(full_name)")
    .eq("market_id", marketId)
    .is("deleted_at", null)
    .not("topic_id", "is", null)
    .gte("created_at", marketDayStartUtc(from, marketId)!)
    .lte("created_at", marketDayEndUtc(to, marketId)!);
  if (family) quotesQ = quotesQ.in("product_id", family.productIds);
  if (agentId === COURIER_AGENT) quotesQ = quotesQ.eq("source", "courier");
  else if (agentId) quotesQ = quotesQ.eq("created_by", agentId);

  // Waiting work is not bound to the period: an open complaint from August is still open.
  let complaintsQ = supabase
    .from("customer_feedback")
    .select("id, created_at")
    .eq("market_id", marketId)
    .eq("category", "reclamation")
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (family) complaintsQ = complaintsQ.in("product_id", family.productIds);

  const [quotesRes, complaintsRes] = await Promise.all([
    quotesQ.order("created_at", { ascending: false }).limit(1000),
    complaintsQ,
  ]);
  const quoteRows = ((quotesRes.data ?? []) as unknown as (Omit<QuoteRow, "author"> & { author: { full_name: string | null } | null })[])
    .map((r) => ({ ...r, author: r.author ? (r.author.full_name ?? "").trim() || null : null }));
  const quotes = pickQuotes(quoteRows, QUOTES_PER_REASON);
  const withQuotes = (x: VoiceReason): FeedbackReason => ({
    ...x,
    quotes: (quotes.get(x.topicId) ?? []).map((q) => ({ id: q.id, body: q.body, moment: q.moment, source: q.source, author: q.author })),
  });
  const open = (complaintsRes.data ?? []) as { id: string }[];

  // A family earns a place in the product filter while it is sold, or while it has feedback.
  const activeIds = new Set(products.filter((p) => p.is_active).map((p) => p.id));
  const mentioned = new Set(((cubeRes.data ?? []) as CubeRow[]).map((r) => r.product_id));
  const shownFamilies = families.filter((f) => f.productIds.some((id) => activeIds.has(id) || mentioned.has(id)));

  const body: FeedbackOverviewResponse = {
    today,
    first,
    from,
    to,
    preset: activePreset(from, to, today, first),
    hasPrev,
    families: shownFamilies,
    topics,
    agents,
    total: v.total,
    kpis: v.kpis,
    toCheck: v.toCheck,
    reasons: v.reasons.map(withQuotes),
    gone: v.gone.map(withQuotes),
    wants: v.wants.map(withQuotes),
    wantsGone: v.wantsGone.map(withQuotes),
    complaints: { open: open.length, firstOpenId: open[0]?.id ?? null },
  };
  return NextResponse.json({ data: body });
}

export const GET = withRouteErrors("/api/feedback/overview", "GET", handleGET);
