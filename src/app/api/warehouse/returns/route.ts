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
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import {
  narrowAtDarb,
  readOnTheWay,
  readProcessed,
  warehouseNames,
  type ReturnsPayload,
} from "./returns-data";

export const dynamic = "force-dynamic";

export type ReturnsQueuePage = ReturnsPayload;

/**
 * GET /api/warehouse/returns — « Rentrer » for one building.
 *
 * `warehouse_id` narrows a manager to the building the desk switch chose; an
 * agent is pinned to their own whatever the query says, and an agent with no
 * building sees nothing (`siteUnassigned`). The lists are described in
 * `returns-data.ts`.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = clampQueueLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = decodeQueueCursor(req.nextUrl.searchParams.get("cursor"));
  // A super-admin viewing Libye must not be handed the Tunisian returns queue.
  const { marketId, marketCode } = resolveWarehouseScope(req, actor);

  const supabase = await createClient();
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: req.nextUrl.searchParams.get("warehouse_id"),
  });
  if (site.unassigned) {
    const empty: ReturnsPayload = { orders: [], nextCursor: null, onTheWay: [], processed: [], siteUnassigned: true };
    return NextResponse.json(empty);
  }

  const { data, error } = await supabase.rpc("get_to_be_returned_orders", {
    p_market_id: marketId,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.timestamp ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const raw = (data ?? []) as Array<Omit<WarehouseOrderRow, "current_stock" | "low_stock_threshold">>;
  const { rows, nextCursor } = buildQueuePageMeta(raw, limit);
  // Building names are place names painted on a wall: Libya reads them in Arabic.
  const names = await warehouseNames(supabase, marketId, marketCode === "ly");

  const [orders, onTheWay, processed] = await Promise.all([
    narrowAtDarb(
      supabase,
      rows.map((o) => ({ ...o, current_stock: null, low_stock_threshold: null }) as WarehouseOrderRow),
      { site: site.warehouseId, names },
    ),
    readOnTheWay(supabase, { marketId, site: site.warehouseId, names }),
    // The decisions history is the desk's; the agent's phone never shows it.
    actor.role === "warehouse_agent"
      ? Promise.resolve([])
      : readProcessed(supabase, { marketId, site: site.warehouseId, names }),
  ]);

  const body: ReturnsPayload = { orders, nextCursor, onTheWay, processed };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
    },
  });
}
