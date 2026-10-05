import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import {
  buildQueuePageMeta,
  clampQueueLimit,
  decodeQueueCursor,
} from "@/lib/warehouse/queue-cursor";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { attachProductImages } from "@/lib/warehouse/product-images";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { enrichReturns, type ReturnFacts } from "@/lib/warehouse/returns-enrich";

export const dynamic = "force-dynamic";

export interface ReturnsQueuePage {
  orders: Array<WarehouseOrderRow & ReturnFacts>;
  nextCursor: string | null;
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = clampQueueLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = decodeQueueCursor(req.nextUrl.searchParams.get("cursor"));
  // A super-admin viewing Libye must not be handed the Tunisian returns queue.
  // This route used to pass null for them, so the list and the KPI card above
  // it disagreed on screen: "0 dans la file" over fifty Tunisian rows.
  const { marketId: marketScope } = resolveWarehouseScope(req, actor);

  /*
   * `state=way`: parcels Darb is still bringing back (`returning`) — not
   * receivable yet, but the desk shows them so a manager knows what is coming.
   * Default: what Darb holds for us (`to_be_returned`), the receivable queue.
   */
  const way = req.nextUrl.searchParams.get("state") === "way";
  const warehouseId = req.nextUrl.searchParams.get("warehouse_id");
  const supabase = await createClient();

  let raw: Array<Omit<WarehouseOrderRow, "current_stock" | "low_stock_threshold">>;
  if (way) {
    let q = supabase
      .from("orders")
      .select(
        "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at, tracking_number, carrier_sticker_ref, carrier_status_slug",
      )
      .eq("status", "returning")
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(limit + 1);
    if (marketScope) q = q.eq("market_id", marketScope);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    raw = (data ?? []) as unknown as typeof raw;
  } else {
    const { data, error } = await supabase.rpc("get_to_be_returned_orders", {
      p_market_id: marketScope,
      p_limit: limit + 1,
      p_cursor_created_at: cursor?.timestamp ?? null,
      p_cursor_id: cursor?.id ?? null,
    });
    if (error) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    raw = (data ?? []) as typeof raw;
  }

  const { rows, nextCursor } = buildQueuePageMeta(raw, limit);

  // The building and since when Darb has held it: two reads beside the RPC,
  // joined in returns-enrich.ts. Neither existed on the row.
  const ids = rows.map((r) => r.id);
  const [{ data: meta }, { data: hist }] = ids.length
    ? await Promise.all([
        supabase.from("orders").select("id, warehouse_id").in("id", ids),
        supabase
          .from("order_history")
          .select("order_id, created_at")
          .in("order_id", ids)
          .eq("status_to", way ? "returning" : "to_be_returned"),
      ])
    : [{ data: [] }, { data: [] }];
  const enriched = enrichReturns(
    rows,
    (meta ?? []) as Array<{ id: string; warehouse_id: string | null }>,
    (hist ?? []) as Array<{ order_id: string; created_at: string }>,
    new Date(),
    warehouseId,
  );

  const pictured = await attachProductImages(supabase, enriched);
  const orders = pictured.map((o) => ({
    ...o,
    current_stock: null,
    low_stock_threshold: null,
  })) as ReturnsQueuePage["orders"];

  const body: ReturnsQueuePage = { orders, nextCursor };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
    },
  });
}

export const GET = withRouteErrors("/api/warehouse/returns", "GET", handleGET);
