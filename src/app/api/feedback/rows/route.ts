import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageFeedback } from "@/lib/role-permissions";
import { resolveFeedbackMarket } from "@/lib/feedback/api";
import { presetRange } from "@/lib/feedback/date-range";
import { loadFamilies, readRange } from "@/lib/feedback/server-data";
import { COURIER_AGENT } from "@/lib/feedback/voice";
import { marketDayEndUtc, marketDayStartUtc, todayInMarket } from "@/lib/dates/market-day";
import type { FeedbackRowsResponse, FeedbackSheetRow } from "@/types/feedback";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** The sheet groups client-side, so it loads the whole period — a month is ~100 rows. */
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
/** An id or an agent filter: never anything PostgREST could read as syntax. */
const SAFE_ID = /^[\w-]{1,64}$/;

const SELECT = [
  "id, created_at, category, topic_id, body, moment, source, status",
  "product:products(id, name, image_url)",
  "customer:customers(name)",
  "order:orders(id, external_id, customer_name, customer_phone)",
  "author:users!customer_feedback_created_by_fkey(id, full_name)",
  "assignee:users!customer_feedback_assigned_to_fkey(id, full_name)",
].join(", ");

interface RawRow {
  id: string; created_at: string; category: FeedbackSheetRow["category"]; topic_id: string | null; body: string;
  moment: FeedbackSheetRow["moment"]; source: FeedbackSheetRow["source"]; status: FeedbackSheetRow["status"];
  product: { id: string; name: string; image_url: string | null } | null;
  customer: { name: string | null } | null;
  order: { id: string; external_id: string | null; customer_name: string | null; customer_phone: string | null } | null;
  author: { id: string; full_name: string | null } | null;
  assignee: { id: string; full_name: string | null } | null;
}

const person = (u: { id: string; full_name: string | null } | null) =>
  u ? { id: u.id, name: (u.full_name ?? "").trim() || u.id.slice(0, 6) } : null;

/**
 * GET /api/feedback/rows — the sheet (prototype voix-du-client-et-messages-v2), newest first:
 * every live row of [from, to] under the family and « Saisi par » filters. The saved views,
 * the grouping and the « à vérifier » pile are the page's business — it holds the period.
 *
 * `id` reads one row whatever its date: the drawer that « 1 réclamation ouverte » opens.
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
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));

  const supabase = await createClient();
  let q = supabase
    .from("customer_feedback")
    .select(SELECT, { count: "exact" })
    .eq("market_id", marketId)
    .is("deleted_at", null);

  const id = params.get("id");
  if (id !== null) {
    if (!SAFE_ID.test(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    q = q.eq("id", id);
  } else {
    const range = readRange(params, presetRange("d30", todayInMarket(marketId), null));
    if (!range) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
    q = q
      .gte("created_at", marketDayStartUtc(range[0], marketId)!)
      .lte("created_at", marketDayEndUtc(range[1], marketId)!);
    const familyParam = params.get("family");
    const family = familyParam ? (await loadFamilies(supabase, marketId)).families.find((f) => f.id === familyParam) ?? null : null;
    if (family) q = q.in("product_id", family.productIds);
    const agent = params.get("agent");
    if (agent === COURIER_AGENT) q = q.eq("source", "courier");
    else if (agent && SAFE_ID.test(agent)) q = q.eq("created_by", agent);
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

export const GET = withRouteErrors("/api/feedback/rows", "GET", handleGET);
