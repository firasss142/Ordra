import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseDeliveryWorklist } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import type { WorklistItem, WorklistRow } from "@/lib/delivery/types";

export const dynamic = "force-dynamic";

/** PostgREST puts `in.(...)` in the URL; keep each request comfortably short. */
const ITEMS_CHUNK = 100;

/**
 * The generated types model a to-one embed as an array; PostgREST returns one
 * object. Accept both.
 */
type Embedded = { image_url: string | null } | { image_url: string | null }[] | null;
const imageOf = (p: Embedded): string | null => (Array.isArray(p) ? p[0]?.image_url : p?.image_url) ?? null;

/**
 * GET /api/delivery/worklist — the post-upload parcels, bucketed by what to do
 * next. The RPC is SECURITY INVOKER, so RLS is the isolation; the scoping below
 * only decides which slice to ask for.
 *   agent          → own parcels in own market; query parameters are ignored
 *   market_manager → own market, optionally one agent
 *   super_admin    → must name the market
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseDeliveryWorklist(actor.role)) {
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

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_delivery_worklist", {
    p_market_id: marketId,
    p_agent_id: agentId,
  });
  if (error) {
    console.error("[api/delivery/worklist] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const raw = (data ?? []) as Omit<WorklistRow, "items">[];
  const ids = raw.map((r) => r.order_id);
  const itemsByOrder = new Map<string, WorklistItem[]>();

  // Both lookups fan out over id chunks; the chunks are independent, so they
  // go out together. Sequential awaits cost one network round trip each, which
  // on a 200-parcel market was ~570 ms of the request.
  const chunks = <T,>(xs: T[]) =>
    Array.from({ length: Math.ceil(xs.length / ITEMS_CHUNK) }, (_, i) => xs.slice(i * ITEMS_CHUNK, (i + 1) * ITEMS_CHUNK));

  const itemResults = await Promise.all(
    chunks(ids).map((slice) =>
      supabase
        .from("order_items")
        .select("order_id, product_name, variant_label, quantity, product:products(image_url)")
        .in("order_id", slice),
    ),
  );
  for (const { data: items, error: itemsError } of itemResults) {
    if (itemsError) {
      // The list is still useful without product names; do not fail it.
      console.error("[api/delivery/worklist] items failed", itemsError);
      continue;
    }
    for (const it of (items ?? []) as (Omit<WorklistItem, "image_url"> & { order_id: string; product: Embedded })[]) {
      const list = itemsByOrder.get(it.order_id) ?? [];
      list.push({
        product_name: it.product_name, variant_label: it.variant_label, quantity: it.quantity,
        image_url: imageOf(it.product),
      });
      itemsByOrder.set(it.order_id, list);
    }
  }

  // Orders older than the multi-product `order_items` table — the large
  // majority of the live Libyan list — carry their one product on the order
  // itself, which is what the agent queue reads. Without this they would show
  // no name and no picture at all.
  const missing = ids.filter((id) => !itemsByOrder.has(id));
  const orderResults = await Promise.all(
    chunks(missing).map((slice) =>
      supabase
        .from("orders")
        .select("id, product_name, variant_label, quantity, product:products!orders_product_id_fkey(image_url)")
        .in("id", slice),
    ),
  );
  for (const { data: orders, error: ordersError } of orderResults) {
    if (ordersError) {
      console.error("[api/delivery/worklist] order products failed", ordersError);
      continue;
    }
    for (const o of (orders ?? []) as { id: string; product_name: string | null; variant_label: string | null; quantity: number | null; product: Embedded }[]) {
      const image_url = imageOf(o.product);
      if (!o.product_name && !image_url) continue;
      itemsByOrder.set(o.id, [{
        product_name: o.product_name, variant_label: o.variant_label, quantity: o.quantity ?? 1, image_url,
      }]);
    }
  }

  const rows: WorklistRow[] = raw.map((r) => ({
    ...r,
    reason_codes: r.reason_codes ?? [],
    risk_reasons: r.risk_reasons ?? [],
    items: itemsByOrder.get(r.order_id) ?? [],
  }));

  return NextResponse.json({ rows, generated_at: new Date().toISOString() });
}
