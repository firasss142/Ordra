import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

/**
 * Resolve the barcode on a returned parcel.
 *
 * Nothing printed on a parcel looks like an OMS uuid: a Tunisian return carries
 * a twelve-digit Cosmos tracking number, a Libyan one carries Darb's sticker.
 * The console used to match the scan against `orders.id`, and only against the
 * page the browser happened to hold, so scanning a real parcel never resolved.
 *
 * The search runs server-side across the whole market for the same reason — a
 * parcel deep in the queue is exactly the one an operator cannot find by eye.
 */

export type ReturnLookupOutcome =
  | "found"
  | "wrong_status"
  | "ambiguous"
  | "not_found"
  | "empty";

export interface ReturnLookupResult {
  outcome: ReturnLookupOutcome;
  code?: string;
  /** Present for `found` and `wrong_status` — the parcel in their hands. */
  order?: WarehouseOrderRow;
  /** Present for `wrong_status`: what the order actually is. */
  status?: string;
  /** Present for `ambiguous`: how many orders the prefix hit. */
  matches?: number;
}

interface Verdict {
  outcome?: ReturnLookupOutcome;
  order_id?: string;
  status?: string;
  matches?: number;
  code?: string;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);

  const { data, error } = await supabase.rpc("find_return_by_code", {
    p_market_id: marketId,
    p_code: code,
  });
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const verdict = (data ?? {}) as Verdict;
  const result: ReturnLookupResult = {
    outcome: verdict.outcome ?? "not_found",
    code: verdict.code ?? code,
  };
  if (verdict.matches !== undefined) result.matches = verdict.matches;
  if (verdict.status !== undefined) result.status = verdict.status;

  // Only fetch the row once the RPC has decided which one it is. An ambiguous
  // or missing verdict has nothing to show, and asking anyway would be a query
  // per failed scan on the busiest screen in the warehouse.
  if (verdict.order_id) {
    const { data: order } = await supabase
      .from("orders")
      .select(
        "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at, tracking_number, carrier_sticker_ref, carrier_status_slug",
      )
      .eq("id", verdict.order_id)
      .maybeSingle();
    if (order) result.order = order as unknown as WarehouseOrderRow;
  }

  return NextResponse.json(result);
}
