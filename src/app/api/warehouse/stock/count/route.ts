import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Record a physical count.
 *
 * The body carries the COUNTED QUANTITY, never a delta: the agent reports what
 * is on the shelf and the RPC derives the correction. A mistyped sign can
 * therefore not invent stock, and the note is mandatory so the ledger keeps
 * its causes. Damaged writeoffs are not reachable from here — those stay on
 * adjust_product_stock, super_admin only.
 */
async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    product_id?: string;
    counted_qty?: number;
    note?: string;
    warehouse_id?: string;
    variant_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const productId = body.product_id?.trim();
  const counted = body.counted_qty;
  const note = body.note?.trim();

  if (!productId) {
    return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
  }
  if (typeof counted !== "number" || !Number.isInteger(counted) || counted < 0) {
    return NextResponse.json(
      { error: "counted_qty must be a whole number of zero or more" },
      { status: 400 },
    );
  }
  if (!note) {
    return NextResponse.json({ error: "A note is required" }, { status: 400 });
  }

  /*
   * A count is a count OF A SHELF, and a shelf keeps sizes apart. Naming the
   * variant makes the count mean "twelve Petit here", which is what the agent
   * can actually verify. Omitted, it stays what it always was: the whole
   * product on this site.
   *
   * Absent and empty both mean "no variant" — a trimmed-to-nothing string is a
   * blank field, not a variant whose id is the empty string. Anything that is
   * neither a string nor absent is a client bug, and is refused rather than
   * coerced: passing it on would make the RPC read it as "no variant" and the
   * agent would be told a count succeeded at the wrong grain.
   */
  if (body.variant_id !== undefined && body.variant_id !== null
      && typeof body.variant_id !== "string") {
    return NextResponse.json(
      { error: "variant_id must be a string" },
      { status: 400 },
    );
  }
  const variantId =
    typeof body.variant_id === "string" && body.variant_id.trim() !== ""
      ? body.variant_id.trim()
      : null;

  const supabase = await createClient();

  /*
   * A count is a count OF A BUILDING. Libya has two, and "we hold 216" is not a
   * fact anyone can verify by walking a single shelf. An agent counts their own
   * site whatever the body says; a manager names the site they counted, and
   * only a caller with no site at all falls back to the market total.
   */
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: body.warehouse_id ?? null,
  });

  /*
   * An unassigned agent must not count. This is a WRITE: with no site the RPC
   * would move the market total, silently attributing one building's shelf to
   * the whole of Libya. Refused here and again in SQL.
   */
  if (site.unassigned) {
    return NextResponse.json(
      { error: "no_site_assigned", error_code: "NO_SITE_ASSIGNED" },
      { status: 409 },
    );
  }

  const { data, error } = await supabase.rpc("record_stock_count", {
    p_product_id: productId,
    p_counted_qty: counted,
    p_actor_id: actor.id,
    p_note: note,
    p_warehouse_id: site.warehouseId,
    p_variant_id: variantId,
  });

  if (error) {
    const m = error.message.toLowerCase();
    const status =
      m.includes("cannot count") || m.includes("another market") ? 403
      : m.includes("not found") ? 404
      : 422;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}

export const POST = withRouteErrors("/api/warehouse/stock/count", "POST", handlePOST);
