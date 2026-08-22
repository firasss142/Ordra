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

export const dynamic = "force-dynamic";

export interface ReturnsQueuePage {
  orders: WarehouseOrderRow[];
  nextCursor: string | null;
}

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
  // This route used to pass null for them, so the list and the KPI card above
  // it disagreed on screen: "0 dans la file" over fifty Tunisian rows.
  const { marketId: marketScope } = resolveWarehouseScope(req, actor);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_to_be_returned_orders", {
    p_market_id: marketScope,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.timestamp ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const raw = (data ?? []) as Array<
    Omit<WarehouseOrderRow, "current_stock" | "low_stock_threshold">
  >;
  const { rows, nextCursor } = buildQueuePageMeta(raw, limit);
  const orders: WarehouseOrderRow[] = rows.map((o) => ({
    ...o,
    current_stock: null,
    low_stock_threshold: null,
  }));

  const body: ReturnsQueuePage = { orders, nextCursor };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
    },
  });
}
