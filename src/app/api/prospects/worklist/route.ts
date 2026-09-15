import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectWorklist } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { bucketOf, HOT_WINDOW_MINUTES, sortWorklist } from "@/lib/prospects/worklist";
import type { ProspectRow } from "@/lib/prospects/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;

/**
 * The statuses an agent still has work to do about, plus the recently won ones
 * so the "Convertis" bucket has something in it. `archived` never appears:
 * a manager soft-closing a lost prospect is how it leaves the list for good.
 */
const WORKING_STATUSES = [
  "new", "assigned", "attempt_1", "attempt_2", "attempt_3",
  "callback_scheduled", "qualified", "won",
];

/** How long a won prospect stays visible under "Convertis". */
const CONVERTED_WINDOW_DAYS = 7;

const intParam = (raw: string | null, fallback: number, min: number, max: number): number => {
  const n = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
};

/** PostgREST models a to-one embed as an array in the generated types. */
type Embed<T> = T | T[] | null;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;

/** `products` has no `price`: the catalogue column is `default_price`. */
interface ProductEmbed { name: string | null; default_price: number | null; image_url: string | null }
/**
 * Only the caller's own script is selected — see the embed below. Sending both
 * languages doubled the largest text field on every campaign row, and the panel
 * renders exactly one of them.
 */
interface CampaignEmbed { name: string | null; offer: string | null; script: string | null }
interface UserEmbed { full_name: string | null }

/**
 * GET /api/prospects/worklist — the pre-order prospects, bucketed by what to do
 * next. RLS on `leads` is the isolation; the scoping below only decides which
 * slice to ask for.
 *   agent          → own prospects in own market; query parameters are ignored
 *   market_manager → own market, optionally one agent
 *   super_admin    → must name the market
 *
 * The bucket is computed here rather than in SQL: a lead has no bucket column,
 * only a status, a source, a callback time and a campaign. bucketOf() is the
 * Design: prototypes/prospects-v3.html.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectWorklist(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  let marketId: string | null;
  let agentId: string | null = null;

  if (actor.role === "agent") {
    marketId = actor.market_id;
    agentId = actor.id;
  } else {
    marketId = actor.role === "super_admin" ? params.get("market_id") : actor.market_id;
    const requestedAgent = params.get("agent_id");
    if (requestedAgent) {
      if (!UUID_RE.test(requestedAgent)) {
        return NextResponse.json({ error: "invalid_agent_id" }, { status: 400 });
      }
      agentId = requestedAgent;
    }
  }
  if (!marketId || !UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  const locale = params.get("locale") === "ar" ? "ar" : "fr";
  // PostgREST aliases the column so the shape is the same in both languages.
  const scriptColumn = locale === "ar" ? "script_ar" : "script_fr";
  const limit = intParam(params.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(
      `id, market_id, status, source, customer_name, customer_phone, customer_city,
       customer_address, product_interest_id, product_interest_note, notes, assigned_to,
       callback_scheduled_at, converted_order_id, campaign_id, source_order_id,
       return_reason, created_at, updated_at,
       products:product_interest_id ( name, default_price, image_url ),
       prospect_campaigns:campaign_id ( name, offer, script:${scriptColumn} ),
       users:assigned_to ( full_name )`,
    )
    .eq("market_id", marketId)
    .in("status", WORKING_STATUSES);

  if (agentId) query = query.eq("assigned_to", agentId);

  // The market's own hot window, fetched alongside the list rather than after
  // it. Both are independent reads; awaiting them in sequence added a whole
  // round trip to every page load for one small number.
  const [{ data, error }, hotWindowRaw] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(limit),
    getMarketSetting(supabase, marketId, "lead_hot_window_minutes", String(HOT_WINDOW_MINUTES)),
  ]);

  const parsedHotWindow = Number(hotWindowRaw);
  const hotWindowMinutes =
    Number.isFinite(parsedHotWindow) && parsedHotWindow > 0 ? parsedHotWindow : HOT_WINDOW_MINUTES;

  if (error) {
    console.error("[api/prospects/worklist] leads query failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const leads = (data ?? []) as unknown as Record<string, unknown>[];

  // Two lookups that need nothing from each other, so they go together. Each
  // is a round trip to a remote database — measured at ~130 ms of latency
  // before any work happens — and in sequence they simply added up.
  //
  //   orders     → the reference a won prospect's order carries, one lookup for
  //                the whole page rather than one per converted card.
  //   enrichment → delivered/returned counts per phone, the same call the agent
  //                queue makes, so the risk badge means the same thing here.
  const orderIds = leads
    .map((l) => l.converted_order_id as string | null)
    .filter((id): id is string => Boolean(id));

  const [ordersResult, enriched] = await Promise.all([
    orderIds.length > 0
      ? supabase.from("orders").select("id, external_id").in("id", orderIds)
      : Promise.resolve({ data: [] as { id: string; external_id: string | null }[] }),
    enrichRowsWithCustomerHistory(supabase, marketId, "lead", leads as never[]),
  ]);

  const refByOrder = new Map<string, string>();
  for (const o of ((ordersResult.data ?? []) as { id: string; external_id: string | null }[])) {
    if (o.external_id) refByOrder.set(o.id, o.external_id);
  }

  const now = Date.now();
  const convertedCutoff = now - CONVERTED_WINDOW_DAYS * 86_400_000;

  const rows: ProspectRow[] = (enriched as unknown as Record<string, unknown>[])
    .map((l) => {
      const product = one(l.products as Embed<ProductEmbed>);
      const campaign = one(l.prospect_campaigns as Embed<CampaignEmbed>);
      const user = one(l.users as Embed<UserEmbed>);
      const convertedOrderId = (l.converted_order_id as string | null) ?? null;

      const base = {
        id: l.id as string,
        market_id: l.market_id as string,
        status: l.status as ProspectRow["status"],
        source: l.source as ProspectRow["source"],
        customer_name: (l.customer_name as string) ?? "",
        customer_phone: (l.customer_phone as string) ?? "",
        customer_city: (l.customer_city as string | null) ?? null,
        customer_address: (l.customer_address as string | null) ?? null,
        product_id: (l.product_interest_id as string | null) ?? null,
        product_name: product?.name ?? null,
        product_price: product?.default_price ?? null,
        product_image_url: product?.image_url ?? null,
        product_note: (l.product_interest_note as string | null) ?? null,
        notes: (l.notes as string | null) ?? null,
        assigned_to: (l.assigned_to as string | null) ?? null,
        assigned_name: user?.full_name ?? null,
        callback_scheduled_at: (l.callback_scheduled_at as string | null) ?? null,
        converted_order_id: convertedOrderId,
        converted_order_ref: convertedOrderId ? (refByOrder.get(convertedOrderId) ?? null) : null,
        campaign_id: (l.campaign_id as string | null) ?? null,
        campaign_name: campaign?.name ?? null,
        campaign_offer: campaign?.offer ?? null,
        campaign_script: campaign?.script ?? null,
        source_order_id: (l.source_order_id as string | null) ?? null,
        source_order_ref: null,
        return_reason: (l.return_reason as string | null) ?? null,
        repeat_kind: (l.repeat_kind as ProspectRow["repeat_kind"]) ?? "none",
        prior_order_count: (l.prior_order_count as number) ?? 0,
        prior_delivered_count: (l.prior_delivered_count as number) ?? 0,
        prior_returned_count: (l.prior_returned_count as number) ?? 0,
        last_known_address: (l.last_known_address as string | null) ?? null,
        created_at: l.created_at as string,
        updated_at: l.updated_at as string,
        last_touch_at: (l.updated_at as string) ?? null,
      };

      return { ...base, bucket: bucketOf(base, now, hotWindowMinutes) } as ProspectRow;
    })
    // A prospect won months ago is history, not work. It leaves the list once
    // its week is up, the way the delivery worklist drops terminal parcels.
    .filter((r) => r.bucket !== "converted" || Date.parse(r.updated_at) >= convertedCutoff);

  const sorted = sortWorklist(rows, now);

  return NextResponse.json({
    rows: sorted,
    // What the page actually holds. The old `count: "exact"` cost a second
    // full index scan per request to produce a figure no surface rendered.
    total: sorted.length,
    // The list is capped, and Tunisia alone has ~1 700 working prospects. A cap
    // that says nothing leaves a manager believing they have seen everything,
    // so the flag is part of the answer rather than something the caller has to
    // infer from the row count.
    truncated: leads.length >= limit,
    hot_window_minutes: hotWindowMinutes,
    generated_at: new Date().toISOString(),
  });
}
