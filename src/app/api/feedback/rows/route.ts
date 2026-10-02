import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { isUuid, resolveFeedbackMarket } from "@/lib/feedback/api";
import { presetRange } from "@/lib/feedback/date-range";
import { loadFamilies, readRange } from "@/lib/feedback/server-data";
import { COMPLAINT_LATE_MS, isFeedbackCategory } from "@/lib/feedback/taxonomy";
import { marketDayEndUtc, marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import type { FeedbackRowsResponse, FeedbackSheetRow } from "@/types/feedback";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

const SELECT = [
  "id, created_at, category, topic_id, body, moment, source, status, needs_review",
  "product:products(id, name, image_url)",
  "customer:customers(name)",
  "order:orders(id, external_id, customer_name, customer_phone)",
  "author:users!customer_feedback_created_by_fkey(id, full_name)",
  "assignee:users!customer_feedback_assigned_to_fkey(id, full_name)",
].join(", ");

interface RawRow {
  id: string; created_at: string; category: FeedbackSheetRow["category"]; topic_id: string | null; body: string;
  moment: FeedbackSheetRow["moment"]; source: FeedbackSheetRow["source"]; status: FeedbackSheetRow["status"]; needs_review: boolean;
  product: { id: string; name: string; image_url: string | null } | null;
  customer: { name: string | null } | null;
  order: { id: string; external_id: string | null; customer_name: string | null; customer_phone: string | null } | null;
  author: { id: string; full_name: string | null } | null;
  assignee: { id: string; full_name: string | null } | null;
}

const person = (u: { id: string; full_name: string | null } | null) =>
  u ? { id: u.id, name: (u.full_name ?? "").trim() || u.id.slice(0, 6) } : null;

/**
 * GET /api/feedback/rows — the manager's sheet (prototype v6), newest first.
 *
 *   mode=period (default) validated, live rows of [from, to], under the family, agent,
 *                         category and topic filters (topic=none is « Sans sujet »);
 *   mode=review           everything awaiting a manager (« À valider »), any date;
 *   mode=late             réclamations open or handled for more than 48 h, any date.
 *
 * `limit` grows by 20 with « Voir n de plus »; `total` is the full count either way.
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

  const mode = params.get("mode") ?? "period";
  if (mode !== "period" && mode !== "review" && mode !== "late") {
    return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  const supabase = await createClient();
  const familyParam = params.get("family");
  const family = familyParam ? (await loadFamilies(supabase, marketId)).families.find((f) => f.id === familyParam) ?? null : null;

  let q = supabase
    .from("customer_feedback")
    .select(SELECT, { count: "exact" })
    .eq("market_id", marketId)
    .is("deleted_at", null);
  if (family) q = q.in("product_id", family.productIds);

  if (mode === "review") {
    q = q.eq("needs_review", true);
  } else if (mode === "late") {
    q = q
      .eq("needs_review", false)
      .eq("category", "reclamation")
      .in("status", ["open", "in_progress"])
      .lt("created_at", new Date(Date.now() - COMPLAINT_LATE_MS).toISOString());
  } else {
    const range = readRange(params, presetRange("d30", todayInMarket(marketId), null));
    if (!range) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
    q = q
      .eq("needs_review", false)
      .gte("created_at", marketDayStartUtc(range[0], marketId)!)
      .lte("created_at", marketDayEndUtc(range[1], marketId)!);
    const agent = params.get("agent");
    if (isUuid(agent) || (agent && /^[\w-]+$/.test(agent))) q = q.eq("created_by", agent);
    const cat = params.get("cat");
    if (isFeedbackCategory(cat)) q = q.eq("category", cat);
    const topic = params.get("topic");
    if (topic === "none") q = q.is("topic_id", null);
    else if (topic) q = q.eq("topic_id", topic);
  }

  const { data, count, error } = await q.order("created_at", { ascending: false }).range(0, limit - 1);
  if (error) {
    console.error("[api/feedback/rows]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows: FeedbackSheetRow[] = ((data ?? []) as unknown as RawRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    category: r.category,
    topic_id: r.topic_id,
    body: r.body,
    moment: r.moment,
    source: r.source,
    status: r.status,
    needs_review: r.needs_review,
    product: r.product ? { id: r.product.id, name: r.product.name, image_url: r.product.image_url } : null,
    customer_name: r.order?.customer_name ?? r.customer?.name ?? null,
    customer_phone: r.order?.customer_phone ?? null,
    order_id: r.order?.id ?? null,
    order_ref: r.order ? r.order.external_id ?? r.order.id.slice(0, 8) : null,
    author: person(r.author),
    assignee: person(r.assignee),
  }));

  const body: FeedbackRowsResponse = { rows, total: count ?? rows.length };
  return NextResponse.json({ data: body });
}
