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

  for (let i = 0; i < ids.length; i += ITEMS_CHUNK) {
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("order_id, product_name, variant_label, quantity")
      .in("order_id", ids.slice(i, i + ITEMS_CHUNK));
    if (itemsError) {
      // The list is still useful without product names; do not fail it.
      console.error("[api/delivery/worklist] items failed", itemsError);
      break;
    }
    for (const it of (items ?? []) as (WorklistItem & { order_id: string })[]) {
      const list = itemsByOrder.get(it.order_id) ?? [];
      list.push({ product_name: it.product_name, variant_label: it.variant_label, quantity: it.quantity });
      itemsByOrder.set(it.order_id, list);
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
