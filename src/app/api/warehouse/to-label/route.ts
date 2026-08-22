import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { SCOPE_COOKIE } from "@/lib/auth/market-scope";
import { isValidScope, scopeToMarketId } from "@/lib/markets";
import {
  buildQueuePageMeta,
  clampQueueLimit,
  decodeQueueCursor,
} from "@/lib/warehouse/queue-cursor";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

export interface ToLabelQueuePage {
  orders: WarehouseOrderRow[];
  nextCursor: string | null;
}

const cacheHeaders = {
  "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
};

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = clampQueueLimit(req.nextUrl.searchParams.get("limit"));
  const cursor = decodeQueueCursor(req.nextUrl.searchParams.get("cursor"));

  const supabase = await createClient();

  /*
   * Super-admins pick a market in the topbar, and the packing bench must obey
   * it: this route used to pass null for them, so a super-admin with "Libye"
   * selected got Tunisian orders in the Libyan queue — cross-market work on a
   * screen whose scan flow is market-specific.
   * An explicit ?market_id wins; otherwise the scope cookie decides.
   */
  const requested = req.nextUrl.searchParams.get("market_id");
  const cookieScope = req.cookies.get(SCOPE_COOKIE)?.value;
  const marketScope =
    actor.role !== "super_admin"
      ? (actor.market_id ?? null)
      : requested && requested !== "all"
        ? requested
        : isValidScope(cookieScope)
          ? scopeToMarketId(cookieScope)
          : null;

  const { data, error } = await supabase.rpc("get_to_label_orders", {
    p_market_id: marketScope,
    p_limit: limit + 1,
    p_cursor_created_at: cursor?.timestamp ?? null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { rows: orders, nextCursor } = buildQueuePageMeta(
    (data ?? []) as WarehouseOrderRow[],
    limit,
  );

  const body: ToLabelQueuePage = { orders, nextCursor };
  return NextResponse.json(body, { headers: cacheHeaders });
}
